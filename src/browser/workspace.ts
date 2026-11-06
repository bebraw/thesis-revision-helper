import { createScrollSync } from "./scroll-sync.js";

export type WorkspaceRequest = (path: string, body?: Record<string, unknown>) => Promise<unknown>;

interface Paragraph {
  start: number;
  end: number;
  text: string;
  safe: boolean;
}
interface DocumentData {
  projectId: string;
  project: string;
  files: string[];
  path: string;
  text: string;
  version: string;
  paragraphs: Paragraph[];
  diagnostics: string[];
  warnings: string[];
  staleProposalContext: boolean;
  undoAvailable: boolean;
  transactionCommitted: boolean;
}
interface Revision {
  id: string;
  projectId: string;
  path: string;
  original: string;
  draft: string;
  draftVersion: number;
  proposal: string | null;
  explanation: string[];
  questions: string[];
  warnings: string[];
  dirty: boolean;
}
interface SavedRevision {
  id: string;
  path: string;
  original: string;
  draft: string;
  draftVersion: number;
}
interface WorkspaceState {
  document: DocumentData | null;
  text: string;
  dirty: boolean;
  selected: number;
  purpose: string | null;
  analysisStatus: string;
  saveStatus: string;
  draftStatus: string;
  revision: Revision | null;
  savedRevisions: SavedRevision[];
  error: string;
  notice: string;
  busy: boolean;
  undoAvailable: boolean;
  review: { warnings: string[]; reviewToken: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid service response.");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid service response.");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid service response.");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid service response.");
  return value.map(string);
}
function documentData(value: unknown): DocumentData {
  const data = object(value);
  if (!Array.isArray(data.paragraphs)) throw new Error("Invalid service response.");
  return {
    projectId: string(data.projectId),
    project: string(data.project),
    files: strings(data.files),
    path: string(data.path),
    text: string(data.text),
    version: string(data.version),
    diagnostics: strings(data.diagnostics),
    paragraphs: data.paragraphs.map((entry: unknown) => {
      const paragraph = object(entry);
      if (typeof paragraph.safe !== "boolean") throw new Error("Invalid service response.");
      const start = number(paragraph.start),
        end = number(paragraph.end),
        text = string(paragraph.text);
      if (end < start || end > string(data.text).length || string(data.text).slice(start, end) !== text)
        throw new Error("Invalid source range in service response.");
      return { start, end, text, safe: paragraph.safe };
    }),
    warnings: data.warnings === undefined ? [] : strings(data.warnings),
    staleProposalContext: data.staleProposalContext === true,
    undoAvailable: data.undoAvailable === true,
    transactionCommitted: data.transactionCommitted === true,
  };
}
function revisionData(value: unknown, projectId: string): Revision {
  const data = object(value);
  return {
    id: string(data.id),
    projectId,
    path: string(data.path),
    original: string(data.original),
    draft: string(data.draft),
    draftVersion: number(data.draftVersion),
    proposal: null,
    explanation: [],
    questions: [],
    warnings: [],
    dirty: false,
  };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

export function createWorkspace(request: WorkspaceRequest, changed: () => void) {
  const state: WorkspaceState = {
    document: null,
    text: "",
    dirty: false,
    selected: -1,
    purpose: null,
    analysisStatus: "Not analysed",
    saveStatus: "No project open",
    draftStatus: "",
    revision: null,
    savedRevisions: [],
    error: "",
    notice: "",
    busy: false,
    undoAvailable: false,
    review: null,
  };
  let editEpoch = 0;
  let composing = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTask: Promise<void> | null = null;
  let draftTask: Promise<void> | null = null;
  let sourceCursor = -1;
  let undoResult: { projectId: string; path: string; version: string; text: string } | null = null;
  const notify = (): void => changed();
  const cancel = (): void => {
    clearTimeout(saveTimer);
    clearTimeout(analysisTimer);
    clearTimeout(draftTimer);
  };
  const selected = (): Paragraph | undefined => state.document?.paragraphs[state.selected];
  const setError = (error: unknown): void => {
    state.error = message(error);
    notify();
  };
  function setDocument(data: DocumentData): void {
    state.document = data;
    state.text = data.text;
    state.dirty = false;
    state.selected = data.paragraphs.findIndex((paragraph) => paragraph.safe);
    state.purpose = null;
    state.analysisStatus = "Pending";
    state.saveStatus = "Saved locally";
    editEpoch += 1;
  }
  function scheduleAnalysis(): void {
    clearTimeout(analysisTimer);
    if (!composing && state.document)
      analysisTimer = setTimeout(() => {
        void analyse();
      }, 1500);
  }
  async function refreshRevisions(): Promise<void> {
    const projectId = state.document?.projectId;
    if (!projectId) return;
    const data = object(await request(`/api/revisions?projectId=${encodeURIComponent(projectId)}`));
    if (state.document?.projectId !== projectId) return;
    if (!Array.isArray(data.revisions)) throw new Error("Invalid service response.");
    state.savedRevisions = data.revisions.map((entry: unknown) => {
      const item = object(entry);
      return {
        id: string(item.id),
        path: string(item.path),
        original: string(item.original),
        draft: string(item.draft),
        draftVersion: number(item.draftVersion),
      };
    });
    notify();
  }
  async function open(path: string): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    notify();
    try {
      if (!(await flushSource()) || !(await flushDraft())) return;
      const data = documentData(await request("/api/open", { path }));
      state.revision = null;
      state.review = null;
      state.savedRevisions = [];
      state.error = "";
      state.notice = "";
      state.undoAvailable = false;
      setDocument(data);
      notify();
      scheduleAnalysis();
      try {
        await refreshRevisions();
      } catch (error) {
        setError(error);
      }
    } catch (error) {
      setError(error);
    } finally {
      state.busy = false;
      notify();
    }
  }
  async function openFile(path: string): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    notify();
    try {
      if (!(await flushSource()) || !(await flushDraft())) return;
      const projectId = state.document?.projectId;
      if (!projectId) return;
      const data = documentData(await request("/api/file", { projectId, path }));
      if (data.projectId !== projectId) throw new Error("Project changed during file selection.");
      state.revision = null;
      state.review = null;
      state.error = "";
      state.undoAvailable = false;
      setDocument(data);
      notify();
      scheduleAnalysis();
      try {
        await refreshRevisions();
      } catch (error) {
        setError(error);
      }
    } catch (error) {
      setError(error);
    } finally {
      state.busy = false;
      notify();
    }
  }
  function updateSource(text: string, cursor?: number): void {
    if (!state.document || state.busy) return;
    sourceCursor = cursor ?? text.length;
    state.text = text;
    state.dirty = text !== state.document.text || saveTask !== null;
    state.undoAvailable = false;
    undoResult = null;
    state.selected = -1;
    state.saveStatus = state.dirty ? "Unsaved changes" : "Saved locally";
    state.purpose = null;
    state.analysisStatus = "stale";
    state.error = "";
    editEpoch += 1;
    clearTimeout(saveTimer);
    if (!composing && state.dirty)
      saveTimer = setTimeout(() => {
        void flushSource();
      }, 1000);
    notify();
    scheduleAnalysis();
  }
  async function flushSource(): Promise<boolean> {
    clearTimeout(saveTimer);
    if (saveTask) {
      await saveTask;
      return state.saveStatus !== "Save failed" && (!state.dirty || (await flushSource()));
    }
    if (!state.document || !state.dirty) return true;
    const { projectId, path, version } = state.document;
    const text = state.text;
    state.saveStatus = "Saving…";
    notify();
    let failed = false;
    saveTask = (async () => {
      try {
        const data = documentData(await request("/api/save", { projectId, path, version, text }));
        if (data.projectId !== projectId || data.path !== path || data.text !== text)
          throw new Error("The saved source does not match the editor.");
        if (state.document?.projectId !== projectId || state.document.path !== path) return;
        state.document = data;
        state.dirty = state.text !== text;
        state.saveStatus = state.dirty ? "Unsaved changes" : "Saved locally";
        if (!state.dirty) {
          const selectedIndex = data.paragraphs.findIndex((item) => sourceCursor >= item.start && sourceCursor <= item.end);
          state.selected = selectedIndex >= 0 ? selectedIndex : data.paragraphs.findIndex((item) => item.safe);
        }
      } catch (error) {
        failed = true;
        state.dirty = true;
        state.saveStatus = "Save failed";
        state.error = message(error);
      }
      notify();
    })();
    await saveTask;
    saveTask = null;
    return !failed && (!state.dirty || (await flushSource()));
  }
  function selectParagraph(index: number): void {
    if (!state.document?.paragraphs[index]) return;
    state.selected = index;
    sourceCursor = state.document?.paragraphs[index]?.start ?? -1;
    state.purpose = null;
    state.analysisStatus = "Pending";
    editEpoch += 1;
    notify();
    scheduleAnalysis();
  }
  async function analyse(): Promise<void> {
    clearTimeout(analysisTimer);
    if (composing || !(await flushSource())) return;
    const data = state.document,
      paragraph = selected(),
      epoch = editEpoch;
    if (!data || !paragraph?.safe) {
      state.analysisStatus = "Unavailable for this passage";
      notify();
      return;
    }
    state.analysisStatus = "Analysing…";
    notify();
    try {
      const response = object(
        await request("/api/analysis", {
          projectId: data.projectId,
          path: data.path,
          version: data.version,
          start: paragraph.start,
          end: paragraph.end,
        }),
      );
      const purpose = response.purpose === null ? null : string(response.purpose);
      const version = string(response.version);
      if (
        epoch !== editEpoch ||
        state.document?.projectId !== data.projectId ||
        state.document.path !== data.path ||
        state.document.version !== version ||
        state.dirty
      )
        return;
      state.purpose = purpose;
      state.analysisStatus = purpose ? "Current · AI interpretation" : "Unclear · AI interpretation";
    } catch (error) {
      if (epoch !== editEpoch) return;
      state.analysisStatus = "Analysis unavailable";
      state.error = message(error);
    }
    notify();
  }
  async function startRevision(mode: "language" | "clarity"): Promise<void> {
    if (state.busy || state.revision) return;
    state.busy = true;
    notify();
    try {
      if (!(await flushSource())) return;
      const data = state.document,
        paragraph = selected();
      if (!data || !paragraph?.safe) throw new Error("Select a supported prose paragraph first.");
      const epoch = editEpoch;
      const revision = revisionData(
        await request("/api/revision/start", {
          projectId: data.projectId,
          path: data.path,
          version: data.version,
          start: paragraph.start,
          end: paragraph.end,
          mode,
        }),
        data.projectId,
      );
      if (
        state.document?.projectId !== data.projectId ||
        state.document.path !== data.path ||
        state.document.version !== data.version ||
        epoch !== editEpoch ||
        state.dirty
      )
        return;
      if (revision.path !== data.path || revision.original !== paragraph.text || revision.draft !== revision.original)
        throw new Error("The revision did not match the selected passage.");
      state.revision = revision;
      state.review = null;
      state.draftStatus = "Draft saved";
      state.error = "";
      state.notice = "";
      notify();
    } catch (error) {
      setError(error);
    } finally {
      state.busy = false;
      notify();
    }
  }
  function updateDraft(text: string): void {
    if (!state.revision || state.busy) return;
    state.revision.draft = text;
    state.revision.dirty = true;
    state.review = null;
    state.draftStatus = "Draft not saved";
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      void flushDraft();
    }, 1000);
    notify();
  }
  async function flushDraft(): Promise<boolean> {
    clearTimeout(draftTimer);
    if (draftTask) {
      await draftTask;
      return state.draftStatus !== "Draft save failed" && (!state.revision?.dirty || (await flushDraft()));
    }
    const revision = state.revision;
    if (!revision || !revision.dirty) return true;
    const projectId = state.document?.projectId;
    if (!projectId || projectId !== revision.projectId || state.document?.path !== revision.path) {
      setError(new Error("The draft belongs to a different project or file."));
      return false;
    }
    const text = revision.draft,
      version = revision.draftVersion;
    state.draftStatus = "Saving draft…";
    notify();
    let failed = false;
    draftTask = (async () => {
      try {
        const data = object(await request("/api/revision/draft", { projectId, id: revision.id, draftVersion: version, text }));
        if (state.revision !== revision) return;
        revision.draftVersion = number(data.draftVersion);
        revision.dirty = revision.draft !== text;
        state.draftStatus = revision.dirty ? "Draft not saved" : "Draft saved";
      } catch (error) {
        failed = true;
        state.draftStatus = "Draft save failed";
        state.error = message(error);
      }
      notify();
    })();
    await draftTask;
    draftTask = null;
    return !failed && (!revision.dirty || (await flushDraft()));
  }
  async function generateProposal(): Promise<void> {
    const revision = state.revision;
    const projectId = state.document?.projectId;
    if (!revision || !projectId || state.busy) return;
    try {
      state.error = "";
      state.notice = "Requesting a possible revision…";
      notify();
      const data = object(await request("/api/revision/proposal", { projectId, id: revision.id }));
      if (data.validation !== undefined && data.validation !== "valid") throw new Error("The proposal failed validation.");
      const proposal = string(data.revision),
        explanation = strings(data.explanation),
        questions = strings(data.questions),
        warnings = data.warnings === undefined ? [] : strings(data.warnings);
      if (state.revision !== revision) return;
      revision.proposal = proposal;
      revision.explanation = explanation;
      revision.questions = questions;
      revision.warnings = warnings;
      state.notice = "One possible revision is ready. Your draft was not changed.";
      notify();
    } catch (error) {
      state.notice = "";
      setError(error);
    }
  }
  async function restoreRevision(id: string): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    notify();
    try {
      if (!(await flushDraft())) return;
      const projectId = state.document?.projectId;
      if (!projectId) return;
      const path = state.document?.path;
      const saved = state.savedRevisions.find((item) => item.id === id);
      if (!saved || saved.path !== path) throw new Error("Open the draft's file before restoring it.");
      const revision = revisionData(await request("/api/revision/restore", { projectId, id }), projectId);
      if (state.document?.projectId !== projectId || state.document.path !== path) return;
      if (revision.path !== path) throw new Error("The restored draft belongs to a different file.");
      state.revision = revision;
      state.review = null;
      state.draftStatus = "Recovered draft";
      state.error = "";
      notify();
    } catch (error) {
      setError(error);
    } finally {
      state.busy = false;
      notify();
    }
  }
  async function closeRevision(): Promise<void> {
    if (state.busy) return;
    if (!(await flushDraft())) return;
    state.revision = null;
    state.review = null;
    state.notice = "Draft saved. You can return to it later.";
    notify();
    try {
      await refreshRevisions();
    } catch (error) {
      setError(error);
    }
  }
  async function commitRevision(reviewToken?: string): Promise<void> {
    if (!state.revision || state.busy) return;
    state.busy = true;
    state.error = "";
    notify();
    try {
      if (!(await flushSource()) || !(await flushDraft())) return;
      const revision = state.revision,
        document = state.document;
      if (!revision || !document || revision.projectId !== document.projectId || revision.path !== document.path) {
        throw new Error("The revision belongs to a different project or file.");
      }
      const body: Record<string, unknown> = { projectId: document.projectId, id: revision.id, draftVersion: revision.draftVersion };
      if (reviewToken !== undefined) body.reviewToken = reviewToken;
      const response = object(await request("/api/revision/commit", body));
      if (response.requiresReview === true) {
        state.review = { warnings: strings(response.warnings), reviewToken: string(response.reviewToken) };
        state.notice = "Review these warnings before committing.";
        notify();
        return;
      }
      const data = documentData(response);
      if (data.projectId !== document.projectId || data.path !== revision.path)
        throw new Error("The committed revision belongs to a different project or file.");
      state.review = null;
      state.undoAvailable = data.undoAvailable;
      undoResult = data.undoAvailable ? { projectId: data.projectId, path: data.path, version: data.version, text: data.text } : null;
      state.revision = null;
      setDocument(data);
      state.notice = [
        data.transactionCommitted ? "Your revision was committed." : "No changes to commit.",
        ...data.warnings,
        ...(data.staleProposalContext ? ["The proposal context had changed."] : []),
      ].join(" ");
      notify();
      scheduleAnalysis();
      try {
        await refreshRevisions();
      } catch (error) {
        setError(error);
      }
    } catch (error) {
      setError(error);
    } finally {
      state.busy = false;
      notify();
    }
  }
  async function undoCommit(): Promise<void> {
    if (state.busy) return;
    const data = state.document;
    if (
      !data ||
      state.dirty ||
      saveTask ||
      !undoResult ||
      data.projectId !== undoResult.projectId ||
      data.path !== undoResult.path ||
      data.version !== undoResult.version ||
      state.text !== undoResult.text
    ) {
      setError(new Error("Cannot undo this revision after other source changes."));
      return;
    }
    state.busy = true;
    notify();
    try {
      const restored = documentData(
        await request("/api/revision/undo", { projectId: data.projectId, path: data.path, version: data.version }),
      );
      if (restored.projectId !== data.projectId || restored.path !== data.path) throw new Error("Project changed during undo.");
      undoResult = null;
      state.undoAvailable = false;
      setDocument(restored);
      state.notice = "Revision undone.";
      state.error = "";
      notify();
      scheduleAnalysis();
    } catch (error) {
      setError(error);
    } finally {
      state.busy = false;
      notify();
    }
  }
  function setComposing(active: boolean): void {
    composing = active;
    if (active) {
      clearTimeout(saveTimer);
      clearTimeout(analysisTimer);
    } else if (state.document) {
      if (state.dirty)
        saveTimer = setTimeout(() => {
          void flushSource();
        }, 1000);
      scheduleAnalysis();
    }
  }
  const confirmCommit = async (): Promise<void> => {
    if (state.review) await commitRevision(state.review.reviewToken);
  };
  const cancelReview = (): void => {
    state.review = null;
    state.notice = "Revision not committed.";
    notify();
  };
  return {
    state,
    open,
    openFile,
    updateSource,
    selectParagraph,
    analyse,
    startRevision,
    updateDraft,
    generateProposal,
    commitRevision,
    confirmCommit,
    cancelReview,
    restoreRevision,
    closeRevision,
    flushSource,
    flushDraft,
    undoCommit,
    setComposing,
    hasPendingChanges: () => state.dirty || saveTask !== null || state.revision?.dirty === true || draftTask !== null,
    dispose: cancel,
  };
}

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing workspace element: ${id}`);
  return node;
}
function input(id: string): HTMLInputElement {
  const node = element(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Invalid workspace input: ${id}`);
  return node;
}
function editor(id: string): HTMLTextAreaElement {
  const node = element(id);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error(`Invalid workspace editor: ${id}`);
  return node;
}

interface Session {
  token: string;
  provider: { name: string; model: string } | null;
}
async function loadSession(): Promise<Session> {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("The local service is unavailable.");
  const data = object(await response.json());
  const provider = data.provider === null ? null : object(data.provider);
  return { token: string(data.token), provider: provider ? { name: string(provider.name), model: string(provider.model) } : null };
}
async function browserRequest(session: Promise<Session>, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const token = (await session).token;
  const response = await fetch(
    path,
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Session-Token": token },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = object(data).error;
    throw new Error(typeof error === "string" ? error : "The local service could not complete the request.");
  }
  return data;
}

function mountWorkspace(): void {
  const source = editor("source");
  const draft = editor("draft");
  const openForm = element("open-form");
  const files = element("files");
  const outline = element("outline");
  const recovery = element("recovery");
  let visibleProposal = true;
  let treeKey = "";
  let outlineKey = "";
  let recoveryKey = "";
  let composing = false;
  let trackedDocument: DocumentData | null = null;
  let visibleIndex: number | null = null;
  let visibleButton: Element | null = null;
  function showVisibleParagraph(index: number | null): void {
    visibleIndex = index;
    const button = index === null ? null : outline.children.item(index);
    if (button === visibleButton) return;
    visibleButton?.removeAttribute("aria-current");
    visibleButton = button;
    visibleButton?.setAttribute("aria-current", "location");
  }
  const scrollSync = createScrollSync(source, showVisibleParagraph);
  const session = loadSession();
  const workspace = createWorkspace((path, body) => browserRequest(session, path, body), render);
  function syncScrollTracking(): void {
    const state = workspace.state;
    if (state.document && !state.dirty && !composing && state.text === state.document.text && source.value === state.text) {
      if (trackedDocument !== state.document) {
        scrollSync.clear();
        showVisibleParagraph(null);
        trackedDocument = state.document;
        scrollSync.update(state.document.text, state.document.paragraphs);
      }
    } else if (trackedDocument) {
      trackedDocument = null;
      scrollSync.clear();
      showVisibleParagraph(null);
    }
  }
  void session
    .then((data) => {
      element("provider-status").textContent = data.provider
        ? `${data.provider.name} · ${data.provider.model}`
        : "No model configured · local editing available";
      input("project-path").disabled = false;
      element("open-project").removeAttribute("disabled");
    })
    .catch((error: unknown) => {
      element("provider-status").textContent = message(error);
    });
  function render(): void {
    const state = workspace.state;
    element("empty").hidden = state.document !== null;
    element("workspace").hidden = state.document === null;
    element("project-label").textContent = state.document?.project ?? "No project open";
    element("file-label").textContent = state.document?.path ?? "";
    element("save-status").textContent = state.saveStatus;
    element("analysis-status").textContent = state.analysisStatus;
    element("error").textContent = state.error;
    element("notice").textContent = state.notice;
    element("diagnostics").textContent = state.document?.diagnostics.join(" ") ?? "";
    source.disabled = state.busy || !state.document;
    if (source.value !== state.text) source.value = state.text;
    syncScrollTracking();
    const newTreeKey = JSON.stringify([state.document?.files, state.document?.path]);
    if (treeKey !== newTreeKey) {
      treeKey = newTreeKey;
      files.replaceChildren();
      for (const path of state.document?.files ?? []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-link";
        button.textContent = path;
        button.setAttribute("aria-current", path === state.document?.path ? "page" : "false");
        button.addEventListener("click", () => {
          void workspace.openFile(path);
        });
        files.append(button);
      }
    }
    const newOutlineKey = JSON.stringify([state.document?.paragraphs, state.selected, state.purpose, state.analysisStatus, state.dirty]);
    if (outlineKey !== newOutlineKey) {
      outlineKey = newOutlineKey;
      visibleButton = null;
      outline.replaceChildren();
      for (const [index, paragraph] of (state.document?.paragraphs ?? []).entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "outline-item";
        button.setAttribute("aria-pressed", String(index === state.selected));
        const label = document.createElement("span");
        label.className = "outline-label";
        label.textContent = `Paragraph ${index + 1}`;
        const summary = document.createElement("span");
        summary.className = "outline-summary";
        summary.textContent = !paragraph.safe
          ? "Unsupported syntax"
          : index === state.selected && state.purpose
            ? state.purpose
            : paragraph.text.slice(0, 100);
        button.append(label, summary);
        button.addEventListener("click", () => {
          workspace.selectParagraph(index);
          source.focus();
          source.setSelectionRange(paragraph.start, paragraph.end);
        });
        outline.append(button);
      }
      showVisibleParagraph(visibleIndex);
    }
    const newRecoveryKey = JSON.stringify(state.savedRevisions);
    if (newRecoveryKey !== recoveryKey) {
      recoveryKey = newRecoveryKey;
      recovery.replaceChildren();
      for (const saved of state.savedRevisions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-link";
        button.textContent = `Restore draft · ${saved.path}`;
        button.addEventListener("click", () => {
          void workspace.restoreRevision(saved.id);
        });
        recovery.append(button);
      }
    }
    element("revision").hidden = state.revision === null;
    element("revision-actions").hidden = state.revision !== null;
    element("draft-status").textContent = state.draftStatus;
    element("revision-original").textContent = state.revision?.original ?? "";
    element("revision-proposal").textContent = state.revision?.proposal ?? "Request a proposal when you are ready.";
    element("proposal-panel").hidden = !visibleProposal;
    element("proposal-toggle").textContent = visibleProposal ? "Hide proposal" : "Show proposal";
    element("proposal-toggle").setAttribute("aria-expanded", String(visibleProposal));
    element("explanation").textContent = [...(state.revision?.explanation ?? []), ...(state.revision?.questions ?? [])].join(" ");
    element("proposal-warnings").textContent = (state.revision?.warnings ?? []).join(" ");
    draft.disabled = state.busy;
    if (draft.value !== (state.revision?.draft ?? "")) draft.value = state.revision?.draft ?? "";
    element("commit").toggleAttribute("disabled", state.busy);
    element("commit").hidden = state.review !== null;
    element("review").hidden = state.review === null;
    element("review-warnings").textContent = state.review?.warnings.join("\n") ?? "";
    element("confirm-commit").toggleAttribute("disabled", state.busy);
    element("cancel-review").toggleAttribute("disabled", state.busy);
    element("undo").toggleAttribute("disabled", !state.undoAvailable || state.busy);
    element("undo").setAttribute("data-ready", String(state.undoAvailable));
  }
  openForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void workspace.open(input("project-path").value.trim());
  });
  source.addEventListener("input", () => workspace.updateSource(source.value, source.selectionStart));
  source.addEventListener("compositionstart", () => {
    composing = true;
    workspace.setComposing(true);
    syncScrollTracking();
  });
  source.addEventListener("compositionend", () => {
    composing = false;
    workspace.setComposing(false);
    syncScrollTracking();
  });
  source.addEventListener("select", () => {
    const state = workspace.state;
    if (state.dirty) return;
    const index = state.document?.paragraphs.findIndex((p) => source.selectionStart >= p.start && source.selectionStart <= p.end) ?? -1;
    if (index >= 0 && index !== state.selected) workspace.selectParagraph(index);
  });
  source.addEventListener("keydown", (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z" &&
      element("undo").getAttribute("data-ready") === "true"
    ) {
      event.preventDefault();
      void workspace.undoCommit();
    }
  });
  element("language").addEventListener("click", () => {
    void workspace.startRevision("language");
  });
  element("clarity").addEventListener("click", () => {
    void workspace.startRevision("clarity");
  });
  element("generate").addEventListener("click", () => {
    void workspace.generateProposal();
  });
  element("proposal-toggle").addEventListener("click", () => {
    visibleProposal = !visibleProposal;
    render();
  });
  draft.addEventListener("input", () => workspace.updateDraft(draft.value));
  element("commit").addEventListener("click", () => {
    void workspace.commitRevision();
  });
  element("confirm-commit").addEventListener("click", () => {
    void workspace.confirmCommit();
  });
  element("cancel-review").addEventListener("click", () => workspace.cancelReview());
  element("close-revision").addEventListener("click", () => {
    void workspace.closeRevision();
  });
  element("undo").addEventListener("click", () => {
    void workspace.undoCommit();
  });
  window.addEventListener("beforeunload", (event) => {
    if (workspace.hasPendingChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  render();
}

if (typeof document !== "undefined") mountWorkspace();
