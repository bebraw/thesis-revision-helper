import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCompanion } from "../local/companion.mjs";

describe("local companion", () => {
  let server;
  let base;
  let token;
  let projectId;
  let text = "\\begin{document}\nOriginal paragraph.\n\\end{document}\n";
  let version = "v1";
  let versionCounter = 1;
  const drafts = new Map();
  const store = {
    listFiles: async () => {
      return ["thesis.tex"];
    },
    read: async () => {
      return { bytes: new TextEncoder().encode(text), version };
    },
    save: async (_path, expected, bytes) => {
      if (expected !== version) throw new Error("conflict");
      text = new TextDecoder().decode(bytes);
      version = `v${++versionCounter}`;
      return { bytes, version };
    },
    saveDraft: async (id, value) => {
      drafts.set(id, structuredClone(value));
    },
    readDraft: async (id) => {
      if (id === "corrupt") throw new Error("corrupt draft");
      return drafts.get(id);
    },
    listDrafts: async () => {
      return [...drafts.keys()];
    },
    removeDraft: async (id) => {
      drafts.delete(id);
    },
    close: async () => {},
  };
  const model = {
    analyse: async () => ({ purpose: "Introduces the argument." }),
    propose: async () => ({ revision: "A proposed paragraph.", explanation: ["Clarifies wording."], questions: [] }),
  };
  const post = async (route, body, headers = {}) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json", "x-session-token": token, ...headers },
      body: JSON.stringify(route === "/api/open" ? body : { projectId, ...body }),
    });

  before(async () => {
    server = createCompanion({
      openProject: async (project) =>
        project === "/bad"
          ? {
              listFiles: async () => ["broken.tex"],
              read: async () => {
                throw new Error("cannot read source");
              },
              close: async () => {},
            }
          : store,
      dataDir: "/unused",
      model,
      modelId: "test-model",
      token: "test-session-secret",
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    base = `http://127.0.0.1:${server.address().port}`;
    token = (await (await fetch(`${base}/api/session`)).json()).token;
  });
  after(async () => {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  beforeEach(() => {
    text = "\\begin{document}\nOriginal paragraph.\n\\end{document}\n";
    version = "v1";
    versionCounter = 1;
    drafts.clear();
    model.analyse = async () => ({ purpose: "Introduces the argument." });
    model.propose = async () => ({ revision: "A proposed paragraph.", explanation: ["Clarifies wording."], questions: [] });
  });

  it("rejects foreign origins and requests without the session token", async () => {
    assert.equal((await post("/api/open", { path: "/project" }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post("/api/open", { path: "/project" }, { "x-session-token": "wrong" })).status, 403);
  });

  it("identifies the model provider without exposing provider credentials", async () => {
    const session = await (await fetch(`${base}/api/session`)).json();
    assert.deepEqual(session.provider, { name: "Cloudflare Workers AI", model: "test-model" });
    assert.deepEqual(Object.keys(session).sort(), ["provider", "token"]);
  });

  it("reports unavailable analysis when no model is configured", async () => {
    const inactive = createCompanion({ model: null, token: "another-test-secret" });
    await new Promise((resolve, reject) => {
      inactive.once("error", reject);
      inactive.listen(0, "127.0.0.1", () => {
        inactive.off("error", reject);
        resolve();
      });
    });
    try {
      const session = await (await fetch(`http://127.0.0.1:${inactive.address().port}/api/session`)).json();
      assert.equal(session.provider, null);
    } finally {
      await new Promise((resolve, reject) => inactive.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("saves an edited source against the expected version", async () => {
    const opened = await (await post("/api/open", { path: "/project" })).json();
    projectId = opened.projectId;
    const nextText = opened.text.replace("Original paragraph.", "A student edit.");
    const response = await post("/api/save", { path: opened.path, version: opened.version, text: nextText });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.text, nextText);
    assert.equal(text, nextText);
    assert.notEqual(saved.version, opened.version);
    text = opened.text;
    version = "v1";
  });

  it("rejects a stale source save and preserves the revision draft", async () => {
    const open = await (await post("/api/open", { path: "/project" })).json();
    projectId = open.projectId;
    const paragraph = open.paragraphs[0];
    const revision = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    const draft = await (await post("/api/revision/draft", { id: revision.id, draftVersion: 0, text: "Preserve my draft." })).json();
    text = open.text.replace("Original paragraph.", "External revision.");
    version = "external";
    const response = await post("/api/save", { path: open.path, version: open.version, text: "Changed" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /file changed/i);
    const commit = await post("/api/revision/commit", { id: revision.id, draftVersion: draft.draftVersion });
    assert.equal(commit.status, 400);
    assert.match(text, /External revision/);
    assert.equal(drafts.get(revision.id).session.studentDraft, "Preserve my draft.");
  });

  it("opens, analyses and revises only the student's buffer", async () => {
    const open = await (await post("/api/open", { path: "/project" })).json();
    assert.equal(typeof open.projectId, "string");
    projectId = open.projectId;
    assert.equal(open.text, text);
    const paragraph = open.paragraphs[0];
    assert.equal(paragraph.text, "Original paragraph.");
    const analysis = await (
      await post("/api/analysis", { path: open.path, version: open.version, start: paragraph.start, end: paragraph.end })
    ).json();
    assert.equal(analysis.purpose, "Introduces the argument.");
    const revision = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    assert.equal(revision.path, open.path);
    assert.equal(revision.draft, paragraph.text);
    const proposal = await (await post("/api/revision/proposal", { id: revision.id })).json();
    assert.equal(proposal.revision, "A proposed paragraph.");
    assert.match(text, /Original paragraph/);
    const draft = await (await post("/api/revision/draft", { id: revision.id, draftVersion: 0, text: "Student revision." })).json();
    const response = await post("/api/revision/commit", { id: revision.id, draftVersion: draft.draftVersion });
    assert.equal(response.status, 200);
    const committed = await response.json();
    assert.match(committed.text, /Student revision/);
    assert.doesNotMatch(committed.text, /A proposed paragraph/);
    assert.equal(committed.transactionCommitted, true);
    assert.equal(committed.undoAvailable, true);
    assert.equal(drafts.has(revision.id), false);
    const undo = await post("/api/revision/undo", { path: committed.path, version: committed.version });
    assert.equal(undo.status, 200);
    assert.match((await undo.json()).text, /Original paragraph/);
  });

  it("saves drafts while a proposal is pending without losing the student's later draft", async () => {
    const open = await (await post("/api/open", { path: "/project" })).json();
    projectId = open.projectId;
    const paragraph = open.paragraphs[0];
    const revision = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    let release;
    let started;
    const modelStarted = new Promise((resolve) => {
      started = resolve;
    });
    model.propose = async () => {
      started();
      return await new Promise((resolve) => {
        release = resolve;
      });
    };
    const pending = post("/api/revision/proposal", { id: revision.id });
    await modelStarted;
    const within = async (promise) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("model blocked saving")), 500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    let savedDraft;
    try {
      savedDraft = await (
        await within(
          post("/api/revision/draft", {
            id: revision.id,
            draftVersion: revision.draftVersion,
            text: "My newer draft.",
          }),
        )
      ).json();
      const sourceAttempt = await within(
        post("/api/save", {
          path: open.path,
          version: open.version,
          text: `${open.text}% Changed elsewhere\n`,
        }),
      );
      assert.equal(sourceAttempt.status, 200);
      assert.equal(text, `${open.text}% Changed elsewhere\n`);
    } finally {
      release({ revision: "A possible revision.", explanation: [], questions: [] });
      await pending;
    }
    const restored = await (await post("/api/revision/restore", { id: revision.id })).json();
    assert.equal(restored.path, open.path);
    assert.equal(restored.draft, "My newer draft.");
    assert.equal(restored.draftVersion, savedDraft.draftVersion);
    assert.equal(drafts.get(revision.id).session.proposals.length, 1);
  });

  it("rejects stale requests from a previously open project even when filenames and versions match", async () => {
    const first = await (await post("/api/open", { path: "/first" })).json();
    const second = await (await post("/api/open", { path: "/second" })).json();
    assert.notEqual(first.projectId, second.projectId);
    projectId = second.projectId;
    const before = text;
    const response = await post("/api/file", {
      projectId: first.projectId,
      path: second.path,
    });
    assert.equal(response.status, 400);
    assert.equal(text, before);
    assert.equal((await fetch(`${base}/api/revisions?projectId=${encodeURIComponent(first.projectId)}`)).status, 400);
  });

  it("requires review before committing changed numerical facts", async () => {
    text = "\\begin{document}\nThe count is 10.\n\\end{document}\n";
    version = "v-numbered";
    const open = await (await post("/api/open", { path: "/project" })).json();
    projectId = open.projectId;
    const paragraph = open.paragraphs[0];
    const revision = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    const draft = await (
      await post("/api/revision/draft", {
        id: revision.id,
        draftVersion: 0,
        text: "The count is 20.",
      })
    ).json();
    const response = await post("/api/revision/commit", { id: revision.id, draftVersion: draft.draftVersion });
    assert.equal(response.status, 200);
    const review = await response.json();
    assert.equal(review.requiresReview, true);
    assert.match(review.warnings.join(" "), /numerical/i);
    assert.match(text, /count is 10/);
    assert.equal(drafts.get(revision.id).session.studentDraft, "The count is 20.");
    const denied = await post("/api/revision/commit", { id: revision.id, draftVersion: draft.draftVersion, reviewToken: "forged" });
    assert.equal(denied.status, 400);
    assert.match(text, /count is 10/);
    const confirmed = await post("/api/revision/commit", {
      id: revision.id,
      draftVersion: draft.draftVersion,
      reviewToken: review.reviewToken,
    });
    assert.equal(confirmed.status, 200);
    assert.match((await confirmed.json()).text, /count is 20/);
  });

  it("invalidates warning confirmation if the student changes the draft", async () => {
    text = "\\begin{document}\nThe count is 10.\n\\end{document}\n";
    const open = await (await post("/api/open", { path: "/project" })).json();
    projectId = open.projectId;
    const paragraph = open.paragraphs[0];
    const revision = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    const firstDraft = await (
      await post("/api/revision/draft", {
        id: revision.id,
        draftVersion: 0,
        text: "The count is 20.",
      })
    ).json();
    const review = await (
      await post("/api/revision/commit", {
        id: revision.id,
        draftVersion: firstDraft.draftVersion,
      })
    ).json();
    const nextDraft = await (
      await post("/api/revision/draft", {
        id: revision.id,
        draftVersion: firstDraft.draftVersion,
        text: "The count is 30.",
      })
    ).json();
    const response = await post("/api/revision/commit", {
      id: revision.id,
      draftVersion: nextDraft.draftVersion,
      reviewToken: review.reviewToken,
    });
    assert.equal(response.status, 400);
    assert.match(text, /count is 10/);
    assert.equal(drafts.get(revision.id).session.studentDraft, "The count is 30.");
  });

  it("does not offer undo for a no-op revision or restore an older revision", async () => {
    const open = await (await post("/api/open", { path: "/project" })).json();
    projectId = open.projectId;
    const paragraph = open.paragraphs[0];
    const first = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    const draft = await (
      await post("/api/revision/draft", {
        id: first.id,
        draftVersion: 0,
        text: "Changed paragraph.",
      })
    ).json();
    const committed = await (await post("/api/revision/commit", { id: first.id, draftVersion: draft.draftVersion })).json();
    assert.equal(committed.undoAvailable, true);
    const nextParagraph = committed.paragraphs[0];
    const second = await (
      await post("/api/revision/start", {
        path: committed.path,
        version: committed.version,
        start: nextParagraph.start,
        end: nextParagraph.end,
        mode: "clarity",
      })
    ).json();
    const noop = await (await post("/api/revision/commit", { id: second.id, draftVersion: second.draftVersion })).json();
    assert.equal(noop.transactionCommitted, false);
    assert.equal(noop.undoAvailable, false);
    const attemptedUndo = await post("/api/revision/undo", { path: noop.path, version: noop.version });
    assert.equal(attemptedUndo.status, 400);
    assert.match(text, /Changed paragraph/);
  });

  it("keeps the current project open if another project fails to load", async () => {
    const initial = await (await post("/api/open", { path: "/project" })).json();
    projectId = initial.projectId;
    assert.equal((await post("/api/open", { path: "/bad" })).status, 400);
    const response = await post("/api/file", { path: initial.path });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).projectId, projectId);
  });

  it("skips corrupt draft records without losing other recoverable drafts", async () => {
    const initial = await (await post("/api/open", { path: "/project" })).json();
    projectId = initial.projectId;
    const paragraph = initial.paragraphs[0];
    const revision = await (
      await post("/api/revision/start", {
        path: initial.path,
        version: initial.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    drafts.set("corrupt", {});
    const response = await fetch(`${base}/api/revisions?projectId=${encodeURIComponent(projectId)}`);
    assert.equal(response.status, 200);
    assert.ok((await response.json()).revisions.some((item) => item.id === revision.id));
    drafts.delete("corrupt");
  });

  it("sends surrounding prose and heading and rejects a proposal when its context changes", async () => {
    const manuscript = "\\begin{document}\n\\section{Results}\nEarlier passage.\n\nCurrent passage.\n\nLater passage.\n\\end{document}\n";
    text = manuscript;
    version = "v-context";
    const open = await (await post("/api/open", { path: "/project" })).json();
    projectId = open.projectId;
    const paragraph = open.paragraphs[1];
    let analysisContext;
    model.analyse = async (_source, context) => {
      analysisContext = JSON.parse(context);
      return { purpose: "Explains the result." };
    };
    const analysis = await (
      await post("/api/analysis", { path: open.path, version: open.version, start: paragraph.start, end: paragraph.end })
    ).json();
    assert.equal(analysis.purpose, "Explains the result.");
    assert.deepEqual(analysisContext, { heading: "\\section{Results}", previous: "Earlier passage.", next: "Later passage." });
    assert.match(analysis.contextDigest, /^[0-9a-f]{64}$/);
    const revision = await (
      await post("/api/revision/start", {
        path: open.path,
        version: open.version,
        start: paragraph.start,
        end: paragraph.end,
        mode: "clarity",
      })
    ).json();
    let release;
    let started;
    const modelStarted = new Promise((resolve) => {
      started = resolve;
    });
    let proposalContext;
    model.propose = async (_source, context) => {
      proposalContext = JSON.parse(context);
      started();
      return await new Promise((resolve) => {
        release = resolve;
      });
    };
    const pending = post("/api/revision/proposal", { id: revision.id });
    await modelStarted;
    assert.deepEqual(proposalContext, analysisContext);
    text = manuscript.replace("Earlier passage.", "Earlier passage!");
    version = "v-context-changed";
    release({ revision: "Current paragraph.", explanation: [], questions: [] });
    assert.equal((await pending).status, 400);
    const restored = await (await post("/api/revision/restore", { id: revision.id })).json();
    assert.equal(restored.draft, "Current passage.");
  });
});
