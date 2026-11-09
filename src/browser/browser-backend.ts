import { parseLatex, validateProposalSyntax } from "../thesis/latex.js";
import { commitRevision, recordProposal, startRevision, updateDraft } from "../thesis/revision.js";
import type { RevisionSession } from "../thesis/revision.js";
import type { WorkspaceRequest } from "./workspace.js";

export interface BrowserModel {
  analyse(source: string, context: string): Promise<{ purpose: string | null; tips?: string[] }>;
  propose(
    source: string,
    context: string,
    mode: "language" | "clarity",
  ): Promise<{
    revision: string;
    explanation: string[];
    questions: string[];
  }>;
}
interface Draft {
  id: string;
  sourceVersion: string;
  start: number;
  end: number;
  context: string;
  mode: "language" | "clarity";
  session: RevisionSession;
}
interface StoredWorkspace {
  id: string;
  version: string;
  text: string;
  drafts: Draft[];
}
const storageKey = "thesis-revision-helper.workspace.v1";
const file = "manuscript.tex";
const id = (): string => crypto.randomUUID();
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSaved(raw: string): StoredWorkspace {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.text !== "string" ||
    !Array.isArray(value.drafts)
  )
    throw new Error("The saved workspace is invalid. Copy any recoverable text before clearing browser storage.");
  const drafts = value.drafts.map((item: unknown): Draft => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.sourceVersion !== "string" ||
      !Number.isSafeInteger(item.start) ||
      !Number.isSafeInteger(item.end) ||
      typeof item.start !== "number" ||
      typeof item.end !== "number" ||
      typeof item.context !== "string" ||
      (item.mode !== "language" && item.mode !== "clarity") ||
      !isRecord(item.session) ||
      typeof item.session.originalSource !== "string" ||
      typeof item.session.studentDraft !== "string" ||
      typeof item.session.draftVersion !== "number" ||
      !Number.isSafeInteger(item.session.draftVersion) ||
      item.session.draftVersion < 0 ||
      typeof item.session.contextDigest !== "string"
    )
      throw new Error("The saved workspace contains an invalid draft.");
    const session = startRevision({
      id: item.id,
      blockId: item.id,
      originalSource: item.session.originalSource,
      contextDigest: item.session.contextDigest,
    });
    return {
      id: item.id,
      sourceVersion: item.sourceVersion,
      start: item.start,
      end: item.end,
      context: item.context,
      mode: item.mode,
      session: { ...session, studentDraft: item.session.studentDraft, draftVersion: item.session.draftVersion },
    };
  });
  return { id: value.id, version: value.version, text: value.text, drafts };
}
function currentParagraph(text: string, start: unknown, end: unknown) {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end))
    throw new Error("Invalid paragraph selection.");
  const parsed = parseLatex(text);
  const paragraph = parsed.paragraphs.find((p) => p.start === start && p.end === end && p.safe);
  if (!paragraph) throw new Error("The selected paragraph is unavailable or unsafe.");
  const index = parsed.paragraphs.indexOf(paragraph);
  const heading = parsed.headings.filter((item) => item.start < paragraph.start).at(-1)?.text ?? "";
  const context = JSON.stringify({
    heading: heading.slice(0, 2000),
    previous: (parsed.paragraphs[index - 1]?.analysisText ?? "").slice(0, 4000),
    next: (parsed.paragraphs[index + 1]?.analysisText ?? "").slice(0, 4000),
  });
  return { paragraph, context };
}
function protectedSource(text: string): string[] {
  const parsed = parseLatex(`\\begin{document}\n${text}\n\\end{document}`);
  const paragraph = parsed.paragraphs[0];
  if (
    parsed.diagnostics.length ||
    parsed.headings.length ||
    parsed.paragraphs.length !== 1 ||
    !paragraph?.safe ||
    paragraph.text !== text.trim()
  )
    throw new Error("Cannot verify LaTeX syntax.");
  return paragraph.protectedSpans.map((span) => span.text);
}
function revisionView(draft: Draft) {
  return {
    id: draft.id,
    path: file,
    original: draft.session.originalSource,
    draft: draft.session.studentDraft,
    draftVersion: draft.session.draftVersion,
  };
}

export function createBrowserBackend(options: { storage: Storage; getModel?: () => BrowserModel | null }): WorkspaceRequest {
  let workspace: StoredWorkspace | null = null;
  let storedRaw: string | null = null;
  let undo: { version: string; text: string } | null = null;
  const reviews = new Map<string, { token: string; key: string }>();
  const model = () => options.getModel?.() ?? null;
  function checkStorage(): void {
    try {
      if (options.storage.getItem(storageKey) !== storedRaw)
        throw new Error("The workspace changed in another tab. Copy your work before reloading.");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("The workspace changed")) throw error;
      throw new Error("Browser storage is unavailable. Copy your work somewhere safe.");
    }
  }
  function write(next: StoredWorkspace): void {
    try {
      checkStorage();
      const raw = JSON.stringify(next);
      options.storage.setItem(storageKey, raw);
      workspace = next;
      storedRaw = raw;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("The workspace changed")) throw error;
      throw new Error("Browser storage failed. Your edits remain in the editor; copy them somewhere safe and retry.");
    }
  }
  function opened(): StoredWorkspace {
    if (!workspace) throw new Error("Open a manuscript first.");
    return workspace;
  }
  function requireProject(body: Record<string, unknown>): StoredWorkspace {
    const current = opened();
    if (body.projectId !== current.id) throw new Error("The manuscript changed. Open it again.");
    return current;
  }
  function requireCurrent(body: Record<string, unknown>): StoredWorkspace {
    const current = requireProject(body);
    if (body.path !== file || body.version !== current.version) throw new Error("The manuscript changed. Your draft is preserved.");
    return current;
  }
  function draftFor(current: StoredWorkspace, draftId: unknown): Draft {
    const draft = current.drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error("Revision is unavailable.");
    return draft;
  }
  function replaceDraft(current: StoredWorkspace, draft: Draft): void {
    write({ ...current, drafts: current.drafts.map((item) => (item.id === draft.id ? draft : item)) });
  }
  function state(current: StoredWorkspace) {
    const parsed = parseLatex(current.text);
    return {
      projectId: current.id,
      project: "Browser workspace",
      files: [file],
      path: file,
      text: current.text,
      version: current.version,
      paragraphs: parsed.paragraphs,
      headings: parsed.headings,
      diagnostics: parsed.diagnostics.map((item) => item.message),
    };
  }
  return async (route, input = {}) => {
    if (route === "/api/session") {
      let hasDocument: boolean;
      try {
        hasDocument = options.storage.getItem(storageKey) !== null;
      } catch {
        throw new Error("Browser storage is unavailable.");
      }
      return { provider: model() ? { name: "Local model", model: "Configured model" } : null, hasDocument };
    }
    if (route === "/api/open") {
      let candidateRaw = storedRaw;
      if (!workspace || input.text === undefined) {
        try {
          candidateRaw = options.storage.getItem(storageKey);
        } catch {
          throw new Error("Browser storage is unavailable.");
        }
      }
      if (input.text === undefined) {
        if (candidateRaw === null) throw new Error("No saved manuscript is available.");
        try {
          const restored = parseSaved(candidateRaw);
          workspace = restored;
          storedRaw = candidateRaw;
        } catch {
          throw new Error("The saved workspace could not be read. Your browser storage was not changed.");
        }
      } else {
        if (typeof input.text !== "string") throw new Error("Invalid source text.");
        if (!workspace) storedRaw = candidateRaw;
        write({ id: id(), version: id(), text: input.text, drafts: [] });
      }
      undo = null;
      reviews.clear();
      return state(opened());
    }
    if (route.startsWith("/api/revisions?")) {
      const projectId = new URLSearchParams(route.slice(route.indexOf("?") + 1)).get("projectId");
      const current = requireProject({ projectId });
      return { revisions: current.drafts.map(revisionView) };
    }
    const current = requireProject(input);
    if (route === "/api/file") return state(current);
    if (route === "/api/save") {
      requireCurrent(input);
      if (typeof input.text !== "string") throw new Error("Invalid source text.");
      if (input.text !== current.text) {
        write({ ...current, text: input.text, version: id() });
        undo = null;
      }
      return state(opened());
    }
    if (route === "/api/analysis") {
      requireCurrent(input);
      const { paragraph, context } = currentParagraph(current.text, input.start, input.end);
      const provider = model();
      if (!provider) throw new Error("Analysis is unavailable. Configure a model to enable it.");
      const result = await provider.analyse(paragraph.analysisText, context);
      checkStorage();
      if (workspace?.id !== current.id || workspace.version !== current.version || model() !== provider)
        throw new Error("Analysis is stale because the manuscript or model changed.");
      if (!(result.purpose === null || (typeof result.purpose === "string" && result.purpose.trim() && result.purpose.length <= 4000)))
        throw new Error("Analysis returned an invalid response.");
      const tips = result.tips === undefined ? [] : result.tips;
      if (
        !Array.isArray(tips) ||
        tips.length > 3 ||
        !tips.every((tip: unknown) => typeof tip === "string" && tip.trim().length > 0 && tip.length <= 600)
      )
        throw new Error("Analysis returned an invalid response.");
      return { purpose: result.purpose, tips, version: current.version };
    }
    if (route === "/api/revision/start") {
      requireCurrent(input);
      if (input.mode !== "language" && input.mode !== "clarity") throw new Error("Choose a feedback mode.");
      const { paragraph, context } = currentParagraph(current.text, input.start, input.end);
      const draftId = id();
      const session = startRevision({ id: draftId, blockId: draftId, originalSource: paragraph.text, contextDigest: context });
      const draft: Draft = {
        id: draftId,
        sourceVersion: current.version,
        start: paragraph.start,
        end: paragraph.end,
        context,
        mode: input.mode,
        session,
      };
      write({ ...current, drafts: [...current.drafts, draft] });
      return revisionView(draft);
    }
    if (route === "/api/revision/restore") return revisionView(draftFor(current, input.id));
    if (route === "/api/revision/draft") {
      const draft = draftFor(current, input.id);
      if (typeof input.text !== "string" || typeof input.draftVersion !== "number" || !Number.isSafeInteger(input.draftVersion))
        throw new Error("Invalid draft.");
      const updated = updateDraft(draft.session, input.text, input.draftVersion);
      if (!updated.ok) throw new Error("The revision draft changed.");
      replaceDraft(current, { ...draft, session: updated.session });
      reviews.delete(draft.id);
      return { draftVersion: updated.session.draftVersion };
    }
    if (route === "/api/revision/proposal") {
      const draft = draftFor(current, input.id);
      const provider = model();
      if (!provider) throw new Error("Proposal generation is unavailable. Configure a model to enable it.");
      const output = await provider.propose(draft.session.originalSource, draft.context, draft.mode);
      checkStorage();
      const latest = opened();
      if (latest.id !== current.id || latest.version !== draft.sourceVersion || model() !== provider)
        throw new Error("The proposal is stale because its source or model changed.");
      const liveDraft = draftFor(latest, draft.id);
      const { paragraph, context } = currentParagraph(latest.text, draft.start, draft.end);
      if (paragraph.text !== draft.session.originalSource || context !== draft.context || liveDraft.context !== draft.context)
        throw new Error("The proposal is stale because its source context changed.");
      if (
        typeof output.revision !== "string" ||
        !Array.isArray(output.explanation) ||
        !output.explanation.every((x) => typeof x === "string") ||
        !Array.isArray(output.questions) ||
        !output.questions.every((x) => typeof x === "string")
      )
        throw new Error("The proposal returned an invalid response.");
      const session = recordProposal(
        liveDraft.session,
        {
          id: id(),
          source: output.revision,
          mode: draft.mode,
          contextDigest: draft.context,
          explanation: output.explanation,
          questions: output.questions,
          modelId: "configured",
          promptVersion: "1",
        },
        protectedSource,
      );
      const proposal = session.proposals.at(-1);
      if (!proposal || proposal.validation !== "valid" || !validateProposalSyntax(paragraph, output.revision).valid)
        throw new Error("The proposal failed source-preservation checks. Request another proposal.");
      replaceDraft(latest, { ...liveDraft, session });
      return { revision: proposal.source, explanation: proposal.explanation, questions: proposal.questions, warnings: proposal.warnings };
    }
    if (route === "/api/revision/commit") {
      const draft = draftFor(current, input.id);
      if (draft.sourceVersion !== current.version) throw new Error("The source changed; your draft is preserved for conflict resolution.");
      const { context } = currentParagraph(current.text, draft.start, draft.end);
      if (typeof input.draftVersion !== "number") throw new Error("Invalid draft version.");
      const result = commitRevision(
        draft.session,
        {
          source: current.text,
          startUtf16: draft.start,
          endUtf16: draft.end,
          ambiguous: false,
          currentContextDigest: context,
          expectedDraftVersion: input.draftVersion,
        },
        protectedSource,
      );
      if (result.kind === "conflict") throw new Error("The revision target or draft changed; your draft is preserved.");
      const key = JSON.stringify([
        current.id,
        current.version,
        draft.id,
        draft.session.draftVersion,
        draft.session.studentDraft,
        context,
        result.warnings,
      ]);
      if (result.kind === "committed" && result.warnings.length) {
        if (input.reviewToken === undefined) {
          const token = id();
          reviews.set(draft.id, { token, key });
          return { requiresReview: true, warnings: result.warnings, reviewToken: token };
        }
        const review = reviews.get(draft.id);
        if (!review || review.token !== input.reviewToken || review.key !== key)
          throw new Error("Review confirmation is invalid or out of date; your draft is preserved.");
      }
      const next = {
        ...current,
        text: result.kind === "committed" ? result.transaction.after : current.text,
        version: result.kind === "committed" ? id() : current.version,
        drafts: current.drafts.filter((item) => item.id !== draft.id),
      };
      write(next);
      undo = result.kind === "committed" ? { version: next.version, text: current.text } : null;
      reviews.delete(draft.id);
      return {
        ...state(next),
        warnings: result.warnings,
        staleProposalContext: result.staleProposalContext,
        transactionCommitted: result.kind === "committed",
        undoAvailable: undo !== null,
      };
    }
    if (route === "/api/revision/undo") {
      requireCurrent(input);
      if (!undo || undo.version !== current.version) throw new Error("Undo is unavailable because the manuscript changed.");
      const next = { ...current, version: id(), text: undo.text };
      write(next);
      undo = null;
      return state(next);
    }
    throw new Error("Unknown operation.");
  };
}
