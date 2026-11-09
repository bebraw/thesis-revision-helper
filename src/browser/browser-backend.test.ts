import { describe, expect, it } from "vitest";
import { createBrowserBackend } from "./browser-backend.js";

function storage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}
const source = "\\begin{document}\nAn original paragraph.\n\\end{document}";

describe("browser backend", () => {
  it("restores a locally saved single document after a new session", async () => {
    const store = storage();
    const request = createBrowserBackend({ storage: store });
    const opened = await request("/api/open", { text: source });
    expect(opened).toMatchObject({ text: source });
    const restored = await createBrowserBackend({ storage: store })("/api/open", {});
    expect(restored).toMatchObject({ text: source });
  });

  it("returns source headings with levels and positions when opening and saving", async () => {
    const request = createBrowserBackend({ storage: storage() });
    const text = "\\begin{document}\n\\section{Method}\nFirst paragraph.\n\\subsection{Data}\nSecond paragraph.\n\\end{document}";
    const opened = (await request("/api/open", { text })) as Opened;
    expect(opened).toMatchObject({
      headings: [
        { text: "\\section{Method}", title: "Method", level: 2, start: text.indexOf("\\section") },
        { text: "\\subsection{Data}", title: "Data", level: 3, start: text.indexOf("\\subsection") },
      ],
    });
    const changed = text.replace("Data", "Dataset");
    const saved = await request("/api/save", { projectId: opened.projectId, path: opened.path, version: opened.version, text: changed });
    expect(saved).toMatchObject({
      headings: [
        { title: "Method", level: 2 },
        { title: "Dataset", level: 3 },
      ],
    });
  });
});

type Opened = {
  projectId: string;
  path: string;
  version: string;
  text: string;
  paragraphs: { start: number; end: number; text: string }[];
};
type Started = { id: string; draft: string; draftVersion: number };
async function open(request: ReturnType<typeof createBrowserBackend>): Promise<Opened> {
  return (await request("/api/open", { text: source })) as Opened;
}
async function start(request: ReturnType<typeof createBrowserBackend>, document: Opened): Promise<Started> {
  const paragraph = document.paragraphs[0];
  if (!paragraph) throw new Error("Missing paragraph");
  return (await request("/api/revision/start", {
    projectId: document.projectId,
    path: document.path,
    version: document.version,
    start: paragraph.start,
    end: paragraph.end,
    mode: "language",
  })) as Started;
}

describe("browser workspace safeguards", () => {
  it("returns selected-paragraph feedback without changing the source", async () => {
    const model = {
      analyse: async () => ({ purpose: "Introduces the topic.", tips: ["Clarify the intended audience."] }),
      propose: async () => ({ revision: "", explanation: [], questions: [] }),
    };
    const request = createBrowserBackend({ storage: storage(), getModel: () => model });
    const document = await open(request);
    const paragraph = document.paragraphs[0];
    if (!paragraph) throw new Error("Missing paragraph");
    await expect(
      request("/api/analysis", {
        projectId: document.projectId,
        path: document.path,
        version: document.version,
        start: paragraph.start,
        end: paragraph.end,
      }),
    ).resolves.toEqual({ purpose: "Introduces the topic.", tips: ["Clarify the intended audience."], version: document.version });
    expect(await request("/api/file", { projectId: document.projectId })).toMatchObject({ text: source, version: document.version });
  });

  it("saves a student draft independently and commits it with undo", async () => {
    const store = storage();
    const request = createBrowserBackend({ storage: store });
    const document = await open(request);
    const draft = await start(request, document);
    expect(draft.draft).toBe("An original paragraph.");
    await request("/api/revision/draft", { projectId: document.projectId, id: draft.id, text: "A revised paragraph.", draftVersion: 0 });
    const saved = createBrowserBackend({ storage: store });
    const restored = (await saved("/api/open", {})) as Opened;
    expect(await saved(`/api/revisions?projectId=${restored.projectId}`)).toMatchObject({ revisions: [{ draft: "A revised paragraph." }] });
    const committed = (await saved("/api/revision/commit", { projectId: restored.projectId, id: draft.id, draftVersion: 1 })) as Opened;
    expect(committed.text).toBe("\\begin{document}\nA revised paragraph.\n\\end{document}");
    const undone = (await saved("/api/revision/undo", {
      projectId: restored.projectId,
      path: restored.path,
      version: committed.version,
    })) as Opened;
    expect(undone.text).toBe(source);
  });

  it("preserves the saved draft when source changed before commit", async () => {
    const request = createBrowserBackend({ storage: storage() });
    const document = await open(request);
    const draft = await start(request, document);
    await request("/api/save", {
      projectId: document.projectId,
      path: document.path,
      version: document.version,
      text: source.replace("original", "changed"),
    });
    await expect(request("/api/revision/commit", { projectId: document.projectId, id: draft.id, draftVersion: 0 })).rejects.toThrow(
      "draft is preserved",
    );
    expect(await request("/api/revision/restore", { projectId: document.projectId, id: draft.id })).toMatchObject({
      draft: "An original paragraph.",
    });
  });

  it("reports storage failures without replacing the saved manuscript", async () => {
    const store = storage();
    const request = createBrowserBackend({ storage: store });
    const document = await open(request);
    store.setItem = () => {
      throw new Error("quota exceeded");
    };
    await expect(
      request("/api/save", { projectId: document.projectId, path: document.path, version: document.version, text: "new content" }),
    ).rejects.toThrow("Browser storage failed");
    expect(await createBrowserBackend({ storage: store })("/api/open", {})).toMatchObject({ text: source });
  });

  it("rejects changes made in another browser tab", async () => {
    const store = storage();
    const first = createBrowserBackend({ storage: store });
    const document = await open(first);
    const second = createBrowserBackend({ storage: store });
    await second("/api/open", {});
    await second("/api/save", { projectId: document.projectId, path: document.path, version: document.version, text: "other tab" });
    await expect(
      first("/api/save", { projectId: document.projectId, path: document.path, version: document.version, text: "first tab" }),
    ).rejects.toThrow("another tab");
    await expect(first("/api/open", { text: "replacement" })).rejects.toThrow("another tab");
  });

  it("does not adopt a corrupt external snapshot after a failed restore", async () => {
    const store = storage();
    const request = createBrowserBackend({ storage: store });
    const document = await open(request);
    store.setItem("thesis-revision-helper.workspace.v1", "corrupted");
    await expect(request("/api/open", {})).rejects.toThrow("could not be read");
    await expect(
      request("/api/save", { projectId: document.projectId, path: document.path, version: document.version, text: "new text" }),
    ).rejects.toThrow("another tab");
    expect(store.getItem("thesis-revision-helper.workspace.v1")).toBe("corrupted");
  });

  it("does not publish analysis after the source changes", async () => {
    let finish: ((value: { purpose: string | null }) => void) | undefined;
    const model = {
      analyse: () =>
        new Promise<{ purpose: string | null }>((resolve) => {
          finish = resolve;
        }),
      propose: async () => ({ revision: "", explanation: [], questions: [] }),
    };
    const request = createBrowserBackend({ storage: storage(), getModel: () => model });
    const document = await open(request);
    const paragraph = document.paragraphs[0];
    if (!paragraph) throw new Error("Missing paragraph");
    const pending = request("/api/analysis", {
      projectId: document.projectId,
      path: document.path,
      version: document.version,
      start: paragraph.start,
      end: paragraph.end,
    });
    await request("/api/save", {
      projectId: document.projectId,
      path: document.path,
      version: document.version,
      text: source.replace("original", "changed"),
    });
    finish?.({ purpose: "Old purpose" });
    await expect(pending).rejects.toThrow("stale");
  });
});

it("validates proposals and leaves the student draft untouched", async () => {
  const model = {
    analyse: async () => ({ purpose: "Introduces the topic" }),
    propose: async () => ({ revision: "A possible revision.", explanation: ["Clarifies the wording."], questions: [] }),
  };
  const request = createBrowserBackend({ storage: storage(), getModel: () => model });
  const document = await open(request);
  const draft = await start(request, document);
  expect(await request("/api/revision/proposal", { projectId: document.projectId, id: draft.id })).toMatchObject({
    revision: "A possible revision.",
  });
  expect(await request("/api/revision/restore", { projectId: document.projectId, id: draft.id })).toMatchObject({
    draft: "An original paragraph.",
    draftVersion: 0,
  });
});

it("requires a fresh review before committing changes to numbers", async () => {
  const request = createBrowserBackend({ storage: storage() });
  const document = await open(request);
  const draft = await start(request, document);
  await request("/api/revision/draft", { projectId: document.projectId, id: draft.id, draftVersion: 0, text: "The result is 42." });
  const review = (await request("/api/revision/commit", { projectId: document.projectId, id: draft.id, draftVersion: 1 })) as {
    requiresReview: boolean;
    reviewToken: string;
    warnings: string[];
  };
  expect(review).toMatchObject({ requiresReview: true, warnings: ["Numerical values differ from the original."] });
  await request("/api/revision/draft", { projectId: document.projectId, id: draft.id, draftVersion: 1, text: "The result is 43." });
  await expect(
    request("/api/revision/commit", { projectId: document.projectId, id: draft.id, draftVersion: 2, reviewToken: review.reviewToken }),
  ).rejects.toThrow("out of date");
  expect(await request("/api/revision/restore", { projectId: document.projectId, id: draft.id })).toMatchObject({
    draft: "The result is 43.",
  });
});

it("rejects a proposal that changes protected numbers", async () => {
  const model = {
    analyse: async () => ({ purpose: "Introduces a result" }),
    propose: async () => ({ revision: "There are 43 samples.", explanation: [], questions: [] }),
  };
  const request = createBrowserBackend({ storage: storage(), getModel: () => model });
  const document = (await request("/api/open", { text: "\\begin{document}\nThere are 42 samples.\n\\end{document}" })) as Opened;
  const draft = await start(request, document);
  await expect(request("/api/revision/proposal", { projectId: document.projectId, id: draft.id })).rejects.toThrow("source-preservation");
  expect(await request("/api/revision/restore", { projectId: document.projectId, id: draft.id })).toMatchObject({
    draft: "There are 42 samples.",
  });
});
