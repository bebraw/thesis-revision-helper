import { describe, expect, it } from "vitest";
import { createWorkspace, type WorkspaceRequest } from "./workspace";

const file = {
  projectId: "p1",
  project: "/project",
  files: ["main.tex"],
  path: "main.tex",
  text: "Original.",
  version: "v1",
  paragraphs: [{ start: 0, end: 9, text: "Original.", safe: true }],
  diagnostics: [],
};

describe("workspace controller", () => {
  it("does not let an older analysis failure replace a newer result", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    let analyses = 0;
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/analysis") {
        analyses += 1;
        if (analyses === 1)
          return new Promise((_, reject) => {
            rejectFirst = reject;
          });
        return { purpose: "Explains the finding.", version: "v1" };
      }
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.openText("Original.");
    const oldRequest = workspace.analyse();
    await Promise.resolve();
    await workspace.analyse();
    rejectFirst?.(new Error("Old model failed"));
    await oldRequest;
    expect(workspace.state.purpose).toBe("Explains the finding.");
    expect(workspace.state.analysisStatus).toBe("Current · AI interpretation");
    workspace.dispose();
  });
  it("opens pasted source without treating it as a filesystem path", async () => {
    const request: WorkspaceRequest = async (path, body) => {
      if (path === "/api/open") {
        expect(body).toEqual({ text: "Original." });
        return file;
      }
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.openText("Original.");
    expect(workspace.state.text).toBe("Original.");
    workspace.dispose();
  });
  it("saves source edits and commits only the student's revision", async () => {
    const paths: string[] = [];
    const changedFile = { ...file, text: "Changed.", version: "v2", paragraphs: [{ start: 0, end: 8, text: "Changed.", safe: true }] };
    const committedFile = { ...file, text: "My draft.", version: "v3", paragraphs: [{ start: 0, end: 9, text: "My draft.", safe: true }] };
    const request: WorkspaceRequest = async (path, body) => {
      paths.push(path);
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/save") {
        expect(body).toMatchObject({ projectId: "p1", path: "main.tex", version: "v1", text: "Changed." });
        return changedFile;
      }
      if (path === "/api/revision/start") return { id: "r1", path: "main.tex", original: "Changed.", draft: "Changed.", draftVersion: 1 };
      if (path === "/api/revision/draft") return { draftVersion: 2 };
      if (path === "/api/revision/commit") return { ...committedFile, transactionCommitted: true, undoAvailable: true };
      if (path === "/api/revision/undo") return changedFile;
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    workspace.updateSource("Changed.");
    await workspace.flushSource();
    await workspace.startRevision("language");
    workspace.updateDraft("My draft.");
    await workspace.flushDraft();
    await workspace.commitRevision();
    await workspace.undoCommit();
    expect(workspace.state.text).toBe("Changed.");
    expect(workspace.state.revision).toBeNull();
    expect(paths).toContain("/api/save");
    expect(paths).toContain("/api/revision/commit");
    expect(paths).toContain("/api/revision/undo");
    workspace.dispose();
  });

  it("keeps a reverted edit pending until the in-flight save and its correction finish", async () => {
    let finish: ((value: unknown) => void) | undefined;
    let saves = 0;
    const changed = { ...file, text: "Changed.", version: "v2", paragraphs: [{ start: 0, end: 8, text: "Changed.", safe: true }] };
    const request: WorkspaceRequest = async (path, body) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/save") {
        saves += 1;
        if (saves === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        expect(body).toMatchObject({ version: "v2", text: "Original." });
        return { ...file, version: "v3" };
      }
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    workspace.updateSource("Changed.");
    const pending = workspace.flushSource();
    await Promise.resolve();
    workspace.updateSource("Original.");
    expect(workspace.hasPendingChanges()).toBe(true);
    expect(workspace.state.saveStatus).not.toBe("Saved locally");
    finish?.(changed);
    expect(await pending).toBe(true);
    expect(saves).toBe(2);
    expect(workspace.state.text).toBe("Original.");
    expect(workspace.hasPendingChanges()).toBe(false);
    workspace.dispose();
  });

  it("asks for explicit warning review before committing and does not offer undo for a no-op", async () => {
    let commits = 0;
    const request: WorkspaceRequest = async (path, body) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/revision/start") return { id: "r1", path: "main.tex", original: "Original.", draft: "Original.", draftVersion: 1 };
      if (path === "/api/revision/commit") {
        commits += 1;
        if (commits === 1) return { requiresReview: true, warnings: ["Check the citation."], reviewToken: "review" };
        expect(body?.reviewToken).toBe("review");
        return { ...file, transactionCommitted: false, undoAvailable: false };
      }
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    await workspace.startRevision("language");
    await workspace.commitRevision();
    expect(commits).toBe(1);
    expect(workspace.state.review?.warnings).toEqual(["Check the citation."]);
    expect(workspace.state.revision?.draft).toBe("Original.");
    await workspace.confirmCommit();
    expect(commits).toBe(2);
    expect(workspace.state.undoAvailable).toBe(false);
    expect(workspace.state.notice).toContain("No changes");
    workspace.dispose();
  });
  it("starts from the original and never fills the student draft with a proposal", async () => {
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/revision/start") return { id: "r1", path: "main.tex", original: "Original.", draft: "Original.", draftVersion: 1 };
      if (path === "/api/revision/proposal")
        return { revision: "Suggested.", explanation: [], questions: [], warnings: ["Check the emphasis."] };
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    workspace.selectParagraph(0);
    await workspace.startRevision("language");
    workspace.updateDraft("My own text.");
    await workspace.generateProposal();
    expect(workspace.state.revision?.draft).toBe("My own text.");
    expect(workspace.state.revision?.proposal).toBe("Suggested.");
    expect(workspace.state.revision?.warnings).toEqual(["Check the emphasis."]);
    expect(workspace.state.text).toBe("Original.");
    workspace.dispose();
  });

  it("discards analysis that finishes after selecting another paragraph", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const twoParagraphs = {
      ...file,
      text: "Original. Other.",
      paragraphs: [
        { start: 0, end: 9, text: "Original.", safe: true },
        { start: 10, end: 16, text: "Other.", safe: true },
      ],
    };
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return twoParagraphs;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/analysis") return new Promise((resolve) => (finish = resolve));
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    workspace.selectParagraph(0);
    const pending = workspace.analyse();
    await Promise.resolve();
    workspace.selectParagraph(1);
    finish?.({ purpose: "Outdated purpose", tips: ["Outdated tip"], version: "v1" });
    await pending;
    expect(workspace.state.purpose).not.toBe("Outdated purpose");
    expect(workspace.state.tips).toEqual([]);
    expect(workspace.state.analysisStatus).toBe("Pending");
    workspace.dispose();
  });

  it("clears old tips on selection and edits and rejects delayed feedback", async () => {
    let finish: ((value: unknown) => void) | undefined;
    let count = 0;
    const twoParagraphs = {
      ...file,
      text: "Original. Other.",
      paragraphs: [
        { start: 0, end: 9, text: "Original.", safe: true },
        { start: 10, end: 16, text: "Other.", safe: true },
      ],
    };
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return twoParagraphs;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/analysis") {
        count += 1;
        if (count === 1) return { purpose: "First purpose", tips: ["First tip"], version: "v1" };
        return new Promise((resolve) => (finish = resolve));
      }
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.openText(twoParagraphs.text);
    await workspace.analyse();
    expect(workspace.state.tips).toEqual(["First tip"]);
    workspace.selectParagraph(1);
    expect(workspace.state.tips).toEqual([]);
    const pending = workspace.analyse();
    await Promise.resolve();
    workspace.updateSource("Original. Other updated.", 20);
    expect(workspace.state.tips).toEqual([]);
    finish?.({ purpose: "Old purpose", tips: ["Old tip"], version: "v1" });
    await pending;
    expect(workspace.state.tips).toEqual([]);
    expect(workspace.state.purpose).toBeNull();
    workspace.dispose();
  });

  it("rejects restoring a draft from a different active file", async () => {
    let restored = false;
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?"))
        return { revisions: [{ id: "other", path: "other.tex", original: "Old", draft: "Mine", draftVersion: 1 }] };
      if (path === "/api/revision/restore") restored = true;
      throw new Error("Unexpected request");
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    await workspace.restoreRevision("other");
    expect(restored).toBe(false);
    expect(workspace.state.revision).toBeNull();
    expect(workspace.state.error).toContain("file");
    workspace.dispose();
  });

  it("lists a newly saved draft after switching to another file", async () => {
    let saved = false;
    const otherFile = {
      ...file,
      files: ["main.tex", "other.tex"],
      path: "other.tex",
      text: "Other.",
      version: "v2",
      paragraphs: [{ start: 0, end: 6, text: "Other.", safe: true }],
    };
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return { ...file, files: ["main.tex", "other.tex"] };
      if (path.startsWith("/api/revisions?"))
        return { revisions: saved ? [{ id: "r1", path: "main.tex", original: "Original.", draft: "Mine.", draftVersion: 2 }] : [] };
      if (path === "/api/revision/start") return { id: "r1", path: "main.tex", original: "Original.", draft: "Original.", draftVersion: 1 };
      if (path === "/api/revision/draft") {
        saved = true;
        return { draftVersion: 2 };
      }
      if (path === "/api/file") return otherFile;
      throw new Error(`Unexpected request ${path}`);
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    await workspace.startRevision("language");
    workspace.updateDraft("Mine.");
    await workspace.openFile("other.tex");
    expect(workspace.state.document?.path).toBe("other.tex");
    expect(workspace.state.savedRevisions.map((draft) => draft.id)).toEqual(["r1"]);
    workspace.dispose();
  });

  it("prevents file changes and duplicate starts while a revision start is pending", async () => {
    let finish: ((value: unknown) => void) | undefined;
    let starts = 0;
    let fileRequests = 0;
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions: [] };
      if (path === "/api/file") fileRequests += 1;
      if (path === "/api/revision/start") {
        starts += 1;
        return new Promise((resolve) => (finish = resolve));
      }
      throw new Error("Unexpected request");
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    const pending = workspace.startRevision("language");
    await Promise.resolve();
    await workspace.openFile("other.tex");
    await workspace.startRevision("clarity");
    expect(fileRequests).toBe(0);
    expect(starts).toBe(1);
    finish?.({ id: "r1", path: "main.tex", original: "Original.", draft: "Original.", draftVersion: 1 });
    await pending;
    expect(workspace.state.document?.path).toBe("main.tex");
    expect(workspace.state.revision?.path).toBe("main.tex");
    workspace.dispose();
  });

  it("serializes draft restoration so a second request cannot replace the first", async () => {
    let finish: ((value: unknown) => void) | undefined;
    let restores = 0;
    const revisions = ["r1", "r2"].map((id) => ({ id, path: "main.tex", original: "Original.", draft: "Mine", draftVersion: 1 }));
    const request: WorkspaceRequest = async (path) => {
      if (path === "/api/open") return file;
      if (path.startsWith("/api/revisions?")) return { revisions };
      if (path === "/api/revision/restore") {
        restores += 1;
        return new Promise((resolve) => (finish = resolve));
      }
      throw new Error("Unexpected request");
    };
    const workspace = createWorkspace(request, () => {});
    await workspace.open("/project");
    const pending = workspace.restoreRevision("r1");
    await Promise.resolve();
    await workspace.restoreRevision("r2");
    expect(restores).toBe(1);
    finish?.(revisions[0]);
    await pending;
    expect(workspace.state.revision?.id).toBe("r1");
    workspace.dispose();
  });
});
