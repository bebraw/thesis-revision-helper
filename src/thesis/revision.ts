/** The parser supplies exact protected source in source order, including duplicates. */
export type ProtectedSpanExtractor = (source: string) => readonly string[];

export interface RevisionStart {
  readonly id: string;
  readonly blockId: string;
  readonly originalSource: string;
  readonly contextDigest: string;
}

export interface ProposalInput {
  readonly id: string;
  readonly source: string;
  readonly contextDigest: string;
  readonly mode: "language" | "clarity";
  readonly explanation: readonly string[];
  readonly questions: readonly string[];
  readonly modelId: string;
  readonly promptVersion: string;
}

export interface Proposal extends ProposalInput {
  readonly validation: "valid" | "failed";
  readonly warnings: readonly string[];
}

export interface RevisionSession extends RevisionStart {
  readonly studentDraft: string;
  readonly draftVersion: number;
  readonly proposals: readonly Proposal[];
}

export interface MappedTarget {
  readonly source: string;
  readonly startUtf16: number;
  readonly endUtf16: number;
  readonly ambiguous: boolean;
  readonly currentContextDigest: string;
  readonly expectedDraftVersion: number;
}

export interface SourceTransaction {
  readonly before: string;
  readonly after: string;
  readonly startUtf16: number;
  readonly endUtf16: number;
  readonly inserted: string;
}

export type CommitResult =
  | { readonly kind: "conflict"; readonly reason: "ambiguous-target" | "invalid-range" | "target-changed" | "draft-changed" }
  | { readonly kind: "noop"; readonly staleProposalContext: boolean; readonly warnings: readonly string[] }
  | {
      readonly kind: "committed";
      readonly staleProposalContext: boolean;
      readonly warnings: readonly string[];
      readonly transaction: SourceTransaction;
    };

export type DraftUpdate =
  { readonly ok: true; readonly session: RevisionSession } | { readonly ok: false; readonly reason: "draft-changed" };

export function startRevision(input: RevisionStart): RevisionSession {
  return Object.freeze({ ...input, studentDraft: input.originalSource, draftVersion: 0, proposals: Object.freeze([]) });
}

export function updateDraft(session: RevisionSession, text: string, expectedVersion: number): DraftUpdate {
  if (session.draftVersion !== expectedVersion) return { ok: false, reason: "draft-changed" };
  if (text === session.studentDraft) return { ok: true, session };
  return { ok: true, session: Object.freeze({ ...session, studentDraft: text, draftVersion: session.draftVersion + 1 }) };
}

function canonicalNumber(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  if (unsigned.includes(",")) return `${negative ? "-" : ""}${unsigned}`;
  const [mantissa = "", exponent = "0"] = unsigned.toLowerCase().split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  let digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  let power = BigInt(exponent) - BigInt(fraction.length);
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    power += 1n;
  }
  return `${negative ? "-" : ""}${digits}e${power}`;
}

function quantities(source: string): string[] {
  return (source.match(/(?<![\p{L}\p{N}_])[+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?(?![\p{L}\p{N}_])/gu) ?? []).map(canonicalNumber);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compare(original: string, candidate: string, extractProtected: ProtectedSpanExtractor): string[] {
  const warnings: string[] = [];
  try {
    if (!sameStrings(extractProtected(original), extractProtected(candidate))) warnings.push("Protected LaTeX differs from the original.");
  } catch {
    warnings.push("Protected LaTeX could not be verified.");
  }
  if (!sameStrings(quantities(original).sort(), quantities(candidate).sort())) warnings.push("Numerical values differ from the original.");
  return warnings;
}

function meaningWarnings(original: string, candidate: string): string[] {
  const terms = /\b(?:not|never|no|none|all|every|only|some|may|might|could|must|always|usually|perhaps|possibly|approximately)\b/gi;
  const extractTerms = (text: string) => (text.match(terms) ?? []).map((term) => term.toLowerCase()).sort();
  const warnings: string[] = [];
  if (!sameStrings(extractTerms(original), extractTerms(candidate))) {
    warnings.push("Words expressing negation, quantity, or certainty changed; review the meaning.");
  }
  const oldNumbers = quantities(original);
  const newNumbers = quantities(candidate);
  if (!sameStrings(oldNumbers, newNumbers) && sameStrings([...oldNumbers].sort(), [...newNumbers].sort())) {
    warnings.push("Numerical values changed order; review their attachment to claims.");
  }
  return warnings;
}

export function recordProposal(session: RevisionSession, input: ProposalInput, extractProtected: ProtectedSpanExtractor): RevisionSession {
  if (session.proposals.some((item) => item.id === input.id)) throw new Error("Proposal IDs must be unique within a revision session.");
  const violations = compare(session.originalSource, input.source, extractProtected);
  const warnings = Object.freeze([...violations, ...meaningWarnings(session.originalSource, input.source)]);
  const proposal: Proposal = Object.freeze({
    ...input,
    explanation: Object.freeze([...input.explanation]),
    questions: Object.freeze([...input.questions]),
    validation: violations.length ? "failed" : "valid",
    warnings,
  });
  return Object.freeze({ ...session, proposals: Object.freeze([...session.proposals, proposal]) });
}

function splitsSurrogate(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return false;
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function commitRevision(session: RevisionSession, target: MappedTarget, extractProtected: ProtectedSpanExtractor): CommitResult {
  if (session.draftVersion !== target.expectedDraftVersion) return { kind: "conflict", reason: "draft-changed" };
  if (target.ambiguous) return { kind: "conflict", reason: "ambiguous-target" };
  const { source, startUtf16, endUtf16 } = target;
  if (
    !Number.isSafeInteger(startUtf16) ||
    !Number.isSafeInteger(endUtf16) ||
    startUtf16 < 0 ||
    endUtf16 < startUtf16 ||
    endUtf16 > source.length ||
    splitsSurrogate(source, startUtf16) ||
    splitsSurrogate(source, endUtf16)
  )
    return { kind: "conflict", reason: "invalid-range" };
  if (source.slice(startUtf16, endUtf16) !== session.originalSource) return { kind: "conflict", reason: "target-changed" };
  const warnings = [
    ...compare(session.originalSource, session.studentDraft, extractProtected),
    ...meaningWarnings(session.originalSource, session.studentDraft),
  ];
  const latestProposal = session.proposals.at(-1);
  const staleProposalContext = target.currentContextDigest !== (latestProposal?.contextDigest ?? session.contextDigest);
  if (session.originalSource === session.studentDraft) return { kind: "noop", staleProposalContext, warnings };
  return {
    kind: "committed",
    staleProposalContext,
    warnings,
    transaction: {
      before: source,
      after: source.slice(0, startUtf16) + session.studentDraft + source.slice(endUtf16),
      startUtf16,
      endUtf16,
      inserted: session.studentDraft,
    },
  };
}
