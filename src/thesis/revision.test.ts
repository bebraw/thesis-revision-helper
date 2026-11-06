import { describe, expect, it } from "vitest";
import { commitRevision, recordProposal, startRevision, updateDraft } from "./revision";

const extractProtected = (source: string): string[] => source.match(/\\cite\{[^}]+\}|\$[^$]+\$/g) ?? [];
const base = () => startRevision({ id: "s1", blockId: "p1", originalSource: "A result of 10% \\cite{x}.", contextDigest: "c1" });
const proposal = (source: string) => ({
  id: "proposal-1",
  source,
  contextDigest: "c1",
  mode: "language" as const,
  explanation: ["Clarified"],
  questions: [],
  modelId: "model",
  promptVersion: "v1",
});

describe("student revision", () => {
  it("initialises the student's independent draft from an immutable original snapshot", () => {
    const session = startRevision({
      id: "session-1",
      blockId: "paragraph-1",
      originalSource: "The experiment achieved 10% accuracy.",
      contextDigest: "context-1",
    });

    expect(session.originalSource).toBe("The experiment achieved 10% accuracy.");
    expect(session.studentDraft).toBe(session.originalSource);
    expect(session.proposals).toEqual([]);
    expect(session.draftVersion).toBe(0);
  });

  it("stores a proposal without mutating the student draft or the original snapshot", () => {
    const session = base();
    const result = recordProposal(session, proposal("A 10% result \\cite{x}."), extractProtected);

    expect(result.proposals[0]).toMatchObject({ validation: "valid", source: "A 10% result \\cite{x}." });
    expect(result.studentDraft).toBe(session.originalSource);
    expect(session.proposals).toEqual([]);
  });

  it("records protected syntax or quantity violations as failed proposals", () => {
    const session = recordProposal(base(), proposal("A 20% result \\cite{y}."), extractProtected);
    expect(session.proposals[0]).toMatchObject({
      validation: "failed",
      warnings: ["Protected LaTeX differs from the original.", "Numerical values differ from the original."],
    });
    expect(session.studentDraft).toBe("A result of 10% \\cite{x}.");
  });

  it("commits only the mapped unchanged target as one undoable transaction", () => {
    const result = updateDraft(base(), "My 11% finding \\cite{z}.", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = "😀\nA result of 10% \\cite{x}.\nNext";
    const committed = commitRevision(
      result.session,
      { source, startUtf16: 3, endUtf16: 28, ambiguous: false, currentContextDigest: "c2", expectedDraftVersion: 1 },
      extractProtected,
    );
    expect(committed).toMatchObject({
      kind: "committed",
      staleProposalContext: true,
      warnings: ["Protected LaTeX differs from the original.", "Numerical values differ from the original."],
    });
    if (committed.kind !== "committed") return;
    expect(committed.transaction.before).toBe(source);
    expect(committed.transaction.after).toBe("😀\nMy 11% finding \\cite{z}.\nNext");
  });

  it("preserves the draft on an ambiguous or changed target", () => {
    const session = base();
    const input = {
      source: "A newer passage.",
      startUtf16: 0,
      endUtf16: 16,
      ambiguous: false,
      currentContextDigest: "c1",
      expectedDraftVersion: 0,
    };
    expect(commitRevision(session, input, extractProtected)).toMatchObject({ kind: "conflict", reason: "target-changed" });
    expect(commitRevision(session, { ...input, ambiguous: true }, extractProtected)).toMatchObject({
      kind: "conflict",
      reason: "ambiguous-target",
    });
    expect(session.studentDraft).toBe(session.originalSource);
  });

  it("keeps the latest saved draft when an older draft attempts an update or commit", () => {
    const updated = updateDraft(base(), "Student's words", 0);
    if (!updated.ok) throw new Error("Expected draft update");
    expect(updateDraft(updated.session, "Older version", 0)).toEqual({ ok: false, reason: "draft-changed" });
    expect(
      commitRevision(
        updated.session,
        {
          source: updated.session.originalSource,
          startUtf16: 0,
          endUtf16: updated.session.originalSource.length,
          ambiguous: false,
          currentContextDigest: "c1",
          expectedDraftVersion: 0,
        },
        extractProtected,
      ),
    ).toEqual({ kind: "conflict", reason: "draft-changed" });
    expect(updated.session.studentDraft).toBe("Student's words");
  });

  it("does not create a transaction for an unchanged draft", () => {
    const session = base();
    expect(updateDraft(session, session.originalSource, 0)).toEqual({ ok: true, session });
    expect(
      commitRevision(
        session,
        {
          source: session.originalSource,
          startUtf16: 0,
          endUtf16: session.originalSource.length,
          ambiguous: false,
          currentContextDigest: "c1",
          expectedDraftVersion: 0,
        },
        extractProtected,
      ),
    ).toEqual({ kind: "noop", staleProposalContext: false, warnings: [] });
  });

  it("rejects invalid ranges and spans that split a UTF-16 surrogate pair", () => {
    const session = startRevision({ id: "s", blockId: "b", originalSource: "", contextDigest: "c1" });
    const input = { source: "😀", startUtf16: 0, endUtf16: 0, ambiguous: false, currentContextDigest: "c1", expectedDraftVersion: 0 };
    for (const [startUtf16, endUtf16] of [
      [-1, 0],
      [0, 3],
      [2, 1],
      [1, 1],
      [0.5, 2],
      [Number.NaN, 2],
    ] as const) {
      expect(commitRevision(session, { ...input, startUtf16, endUtf16 }, extractProtected)).toEqual({
        kind: "conflict",
        reason: "invalid-range",
      });
    }
  });

  it("records missing, duplicated, invented, or reordered protected spans", () => {
    const original = startRevision({ id: "s", blockId: "b", originalSource: "A \\cite{x} and \\cite{y}.", contextDigest: "c1" });
    for (const source of ["A \\cite{x}.", "A \\cite{x} \\cite{y} \\cite{y}.", "A \\cite{y} \\cite{x}."]) {
      expect(recordProposal(original, proposal(source), extractProtected).proposals[0]).toMatchObject({
        validation: "failed",
        warnings: ["Protected LaTeX differs from the original."],
      });
    }
  });

  it("allows equivalent decimals but rejects numeric changes", () => {
    const original = startRevision({ id: "s", blockId: "b", originalSource: "The value is 1.00.", contextDigest: "c1" });
    expect(recordProposal(original, proposal("The value is 1."), extractProtected).proposals[0]?.validation).toBe("valid");
    expect(recordProposal(original, proposal("The value is 2."), extractProtected).proposals[0]?.validation).toBe("failed");
  });

  it("recognises scientific notation and rejects changes to its numeric value", () => {
    const original = startRevision({ id: "s", blockId: "b", originalSource: "The value is 1e3.", contextDigest: "c1" });
    expect(recordProposal(original, proposal("The value is 1e4."), extractProtected).proposals[0]).toMatchObject({
      validation: "failed",
      warnings: ["Numerical values differ from the original."],
    });
    expect(recordProposal(original, proposal("The value is 1000."), extractProtected).proposals[0]?.validation).toBe("valid");
  });

  it("warns when numeric values change order without claiming an automatic meaning violation", () => {
    const original = startRevision({ id: "s", blockId: "b", originalSource: "A used 10 and B used 20.", contextDigest: "c1" });
    expect(recordProposal(original, proposal("A used 20 and B used 10."), extractProtected).proposals[0]).toMatchObject({
      validation: "valid",
      warnings: ["Numerical values changed order; review their attachment to claims."],
    });
  });

  it("treats an unavailable protected-span check as a failed proposal and review warning", () => {
    const fail = () => {
      throw new Error("incomplete source");
    };
    const original = base();
    expect(recordProposal(original, proposal(original.originalSource), fail).proposals[0]).toMatchObject({
      validation: "failed",
      warnings: ["Protected LaTeX could not be verified."],
    });
    expect(
      commitRevision(
        original,
        {
          source: original.originalSource,
          startUtf16: 0,
          endUtf16: original.originalSource.length,
          ambiguous: false,
          currentContextDigest: "c1",
          expectedDraftVersion: 0,
        },
        fail,
      ),
    ).toMatchObject({ kind: "noop", warnings: ["Protected LaTeX could not be verified."] });
  });

  it("highlights possible meaning changes without claiming they are preservation violations", () => {
    const original = startRevision({ id: "s", blockId: "b", originalSource: "This may work.", contextDigest: "c1" });
    expect(recordProposal(original, proposal("This always works."), extractProtected).proposals[0]).toMatchObject({
      validation: "valid",
      warnings: ["Words expressing negation, quantity, or certainty changed; review the meaning."],
    });
  });

  it("copies proposal metadata, retains previous records, and rejects duplicate IDs", () => {
    const input = proposal("A 10% result \\cite{x}.");
    const first = recordProposal(base(), input, extractProtected);
    input.explanation.push("Changed later");
    expect(first.proposals[0]?.explanation).toEqual(["Clarified"]);
    const second = recordProposal(first, { ...input, id: "another" }, extractProtected);
    expect(first.proposals).toHaveLength(1);
    expect(second.proposals).toHaveLength(2);
    expect(() => recordProposal(second, input, extractProtected)).toThrow("unique");
  });
});
