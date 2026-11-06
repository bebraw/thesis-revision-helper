import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseLatex, validateProposalSyntax } from "../src/thesis/latex.ts";
import { decodeSource, encodeSource } from "../src/thesis/source-codec.ts";
import { commitRevision, recordProposal, startRevision, updateDraft } from "../src/thesis/revision.ts";
import { createCloudflareModel } from "../src/thesis/cloudflare-model.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataDir = join(homedir(), "Library", "Application Support", "Thesis Revision Helper");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request.");
  return body;
}

function tokenMatches(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseParagraph(source, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new Error("Invalid paragraph selection.");
  const match = parseLatex(source).paragraphs.find((item) => item.start === start && item.end === end && item.safe);
  if (!match) throw new Error("The selected paragraph is unavailable or unsafe.");
  return match;
}

function protectedSource(text) {
  const prefix = "\\begin{document}\n";
  const parsed = parseLatex(`${prefix}${text}\n\\end{document}`);
  const paragraph = parsed.paragraphs[0];
  if (
    parsed.diagnostics.length ||
    parsed.headings.length ||
    parsed.paragraphs.length !== 1 ||
    !paragraph?.safe ||
    paragraph.text !== text.trim()
  ) {
    throw new Error("Cannot verify LaTeX syntax.");
  }
  return paragraph.protectedSpans.map((span) => span.text);
}

function surroundingContext(parsed, paragraph) {
  const index = parsed.paragraphs.findIndex((item) => item.start === paragraph.start && item.end === paragraph.end);
  if (index < 0) throw new Error("The selected paragraph is unavailable.");
  const heading = parsed.headings.filter((item) => item.start < paragraph.start).at(-1)?.text ?? "";
  return JSON.stringify({
    heading: heading.slice(0, 2000),
    previous: (parsed.paragraphs[index - 1]?.analysisText ?? "").slice(0, 4000),
    next: (parsed.paragraphs[index + 1]?.analysisText ?? "").slice(0, 4000),
  });
}

export function createCompanion(options = {}) {
  const token = options.token ?? randomBytes(32).toString("hex");
  const dataDir = options.dataDir ?? defaultDataDir;
  const openProject = options.openProject ?? (async (path) => (await import("./project.mjs")).ProjectStore.open(path, { dataDir }));
  const model = options.model === undefined ? configuredModel() : options.model;
  const modelId = options.modelId ?? process.env.CLOUDFLARE_AI_MODEL ?? "configured-model";
  let store = null;
  let project = null;
  let projectId = null;
  let path = null;
  let lastTransaction = null;
  const reviews = new Map();
  let chain = Promise.resolve();

  function enqueue(action) {
    const task = chain.then(action);
    chain = task.catch(() => {});
    return task;
  }

  function requireProject(id) {
    if (!store || typeof id !== "string" || id !== projectId) throw new Error("The project changed. Open it again.");
  }

  async function snapshotFor(activeStore, file) {
    if (!activeStore || !file) throw new Error("Open a project first.");
    const saved = await activeStore.read(file);
    const decoded = decodeSource(saved.bytes);
    return { file, saved, decoded, parsed: parseLatex(decoded.text) };
  }

  async function snapshot(file) {
    return await snapshotFor(store, file);
  }

  async function stateFor(activeStore, projectName, id, file) {
    const current = await snapshotFor(activeStore, file);
    return {
      project: projectName,
      projectId: id,
      files: await activeStore.listFiles(),
      path: file,
      text: current.decoded.text,
      version: current.saved.version,
      paragraphs: current.parsed.paragraphs,
      headings: current.parsed.headings,
      diagnostics: current.parsed.diagnostics.map((item) => item.message),
    };
  }

  async function state(file) {
    return await stateFor(store, project, projectId, file);
  }

  async function requireCurrent(input) {
    if (typeof input.path !== "string" || typeof input.version !== "string") throw new Error("Invalid source selection.");
    const current = await snapshot(input.path);
    if (current.saved.version !== input.version) throw new Error("The file changed. Reload and resolve the conflict.");
    return current;
  }

  async function getRevision(id) {
    if (!store || typeof id !== "string") throw new Error("Revision is unavailable.");
    const draft = await store.readDraft(id);
    if (!draft || !draft.session || typeof draft.path !== "string") throw new Error("Revision is unavailable.");
    return draft;
  }

  async function operation(route, input) {
    if (route === "/api/open") {
      if (typeof input.path !== "string" || !input.path.trim()) throw new Error("Enter a project directory.");
      const next = await openProject(input.path);
      let first;
      let nextState;
      const nextId = randomUUID();
      try {
        const files = await next.listFiles();
        first = files.find((file) => file.endsWith(".tex"));
        if (!first) throw new Error("No LaTeX source file was found.");
        nextState = await stateFor(next, input.path, nextId, first);
      } catch (error) {
        await next.close();
        throw error;
      }
      await store?.close();
      store = next;
      project = input.path;
      projectId = nextId;
      path = first;
      lastTransaction = null;
      reviews.clear();
      return nextState;
    }
    requireProject(input.projectId);
    if (route === "/api/file") {
      if (typeof input.path !== "string" || !(await store.listFiles()).includes(input.path)) throw new Error("File is unavailable.");
      path = input.path;
      return await state(path);
    }
    if (route === "/api/save") {
      const current = await requireCurrent(input);
      if (typeof input.text !== "string") throw new Error("Invalid source text.");
      if (input.text !== current.decoded.text) {
        await store.save(input.path, input.version, encodeSource(current.decoded, input.text));
        lastTransaction = null;
      }
      return await state(input.path);
    }
    if (route === "/api/analysis") {
      const activeStore = store;
      const current = await requireCurrent(input);
      const paragraph = parseParagraph(current.decoded.text, input.start, input.end);
      if (!model) throw new Error("Analysis is unavailable. Configure a model to enable it.");
      const context = surroundingContext(current.parsed, paragraph);
      const contextDigest = digest(JSON.stringify({ source: paragraph.analysisText, context, promptVersion: "1", modelId }));
      const result = await model.analyse(paragraph.analysisText, context);
      const after = await activeStore.read(input.path);
      if (activeStore !== store || input.projectId !== projectId || after.version !== input.version)
        throw new Error("Analysis is stale because the file or project changed.");
      return { purpose: result.purpose, version: input.version, contextDigest };
    }
    if (route === "/api/revision/start") {
      const current = await requireCurrent(input);
      const paragraph = parseParagraph(current.decoded.text, input.start, input.end);
      if (input.mode !== "clarity" && input.mode !== "language") throw new Error("Choose a feedback mode.");
      const context = surroundingContext(current.parsed, paragraph);
      const id = randomUUID();
      const contextDigest = digest(JSON.stringify({ source: paragraph.text, context, mode: input.mode, promptVersion: "1", modelId }));
      const session = startRevision({ id, blockId: id, originalSource: paragraph.text, contextDigest });
      await store.saveDraft(id, {
        path: input.path,
        version: input.version,
        start: paragraph.start,
        end: paragraph.end,
        paragraph,
        context,
        mode: input.mode,
        session,
      });
      return { id, path: input.path, original: session.originalSource, draft: session.studentDraft, draftVersion: session.draftVersion };
    }
    if (route === "/api/revision/restore") {
      const draft = await getRevision(input.id);
      return {
        id: draft.session.id,
        path: draft.path,
        original: draft.session.originalSource,
        draft: draft.session.studentDraft,
        draftVersion: draft.session.draftVersion,
      };
    }
    if (route === "/api/revision/draft") {
      const draft = await getRevision(input.id);
      if (typeof input.text !== "string" || !Number.isSafeInteger(input.draftVersion)) throw new Error("Invalid draft.");
      const updated = updateDraft(draft.session, input.text, input.draftVersion);
      if (!updated.ok) throw new Error("The revision draft changed.");
      if (updated.session !== draft.session) reviews.delete(input.id);
      draft.session = updated.session;
      await store.saveDraft(input.id, draft);
      return { draftVersion: draft.session.draftVersion };
    }
    if (route === "/api/revision/commit") {
      const draft = await getRevision(input.id);
      const current = await snapshot(draft.path);
      if (current.saved.version !== draft.version) throw new Error("The source changed; your draft is preserved for conflict resolution.");
      const paragraph = parseParagraph(current.decoded.text, draft.start, draft.end);
      const context = surroundingContext(current.parsed, paragraph);
      const contextDigest = digest(JSON.stringify({ source: paragraph.text, context, mode: draft.mode, promptVersion: "1", modelId }));
      const result = commitRevision(
        draft.session,
        {
          source: current.decoded.text,
          startUtf16: draft.start,
          endUtf16: draft.end,
          ambiguous: false,
          currentContextDigest: contextDigest,
          expectedDraftVersion: input.draftVersion,
        },
        protectedSource,
      );
      if (result.kind === "conflict") throw new Error("The revision target or draft changed; your draft is preserved.");
      const reviewKey = digest(
        JSON.stringify({
          projectId,
          id: input.id,
          file: draft.path,
          version: current.saved.version,
          draftVersion: draft.session.draftVersion,
          text: draft.session.studentDraft,
          contextDigest,
          warnings: result.warnings,
        }),
      );
      if (result.kind === "committed" && result.warnings.length) {
        if (input.reviewToken === undefined) {
          const reviewToken = randomBytes(32).toString("hex");
          reviews.set(input.id, { reviewToken, reviewKey });
          return { requiresReview: true, warnings: result.warnings, reviewToken };
        }
        const review = reviews.get(input.id);
        if (!review || !tokenMatches(input.reviewToken, review.reviewToken) || review.reviewKey !== reviewKey)
          throw new Error("Review confirmation is invalid or out of date; your draft is preserved.");
      }
      let transactionCommitted = false;
      if (result.kind === "committed") {
        const saved = await store.save(draft.path, current.saved.version, encodeSource(current.decoded, result.transaction.after));
        lastTransaction = { path: draft.path, version: saved.version, before: current.saved.bytes };
        transactionCommitted = true;
      } else {
        lastTransaction = null;
      }
      reviews.delete(input.id);
      const warnings = [...result.warnings];
      try {
        await store.removeDraft(input.id);
      } catch {
        warnings.push("The revision finished, but its saved draft could not be removed.");
      }
      return {
        ...(await state(draft.path)),
        warnings,
        staleProposalContext: result.staleProposalContext,
        transactionCommitted,
        undoAvailable: transactionCommitted,
      };
    }
    if (route === "/api/revision/undo") {
      if (!lastTransaction || input.path !== lastTransaction.path || input.version !== lastTransaction.version)
        throw new Error("Undo is unavailable because the file changed.");
      await store.save(lastTransaction.path, lastTransaction.version, lastTransaction.before);
      lastTransaction = null;
      return await state(input.path);
    }
    throw new Error("Unknown operation.");
  }

  async function generateProposal(input) {
    if (!model) throw new Error("Proposal generation is unavailable. Configure a model to enable it.");
    const prepared = await enqueue(async () => {
      requireProject(input.projectId);
      const draft = await getRevision(input.id);
      return { draft, store };
    });
    const output = await model.propose(prepared.draft.session.originalSource, prepared.draft.context, prepared.draft.mode);
    return await enqueue(async () => {
      requireProject(input.projectId);
      if (!store || store !== prepared.store) throw new Error("The project changed while the proposal was generated.");
      const draft = await getRevision(input.id);
      if (
        draft.path !== prepared.draft.path ||
        draft.context !== prepared.draft.context ||
        draft.mode !== prepared.draft.mode ||
        draft.session.originalSource !== prepared.draft.session.originalSource ||
        draft.session.contextDigest !== prepared.draft.session.contextDigest
      ) {
        throw new Error("The revision changed while the proposal was generated.");
      }
      const current = await snapshot(draft.path);
      const currentParagraph = parseParagraph(current.decoded.text, draft.start, draft.end);
      if (
        currentParagraph.text !== draft.session.originalSource ||
        surroundingContext(current.parsed, currentParagraph) !== draft.context
      ) {
        throw new Error("The proposal is stale because its source context changed.");
      }
      const syntax = validateProposalSyntax(prepared.draft.paragraph, output.revision);
      draft.session = recordProposal(
        draft.session,
        {
          id: randomUUID(),
          source: output.revision,
          mode: draft.mode,
          contextDigest: draft.session.contextDigest,
          explanation: output.explanation,
          questions: output.questions,
          modelId,
          promptVersion: "1",
        },
        protectedSource,
      );
      let proposal = draft.session.proposals.at(-1);
      if (!syntax.valid && proposal?.validation === "valid") {
        proposal = { ...proposal, validation: "failed", warnings: [...proposal.warnings, "LaTeX syntax could not be preserved."] };
        draft.session = { ...draft.session, proposals: [...draft.session.proposals.slice(0, -1), proposal] };
      }
      await store.saveDraft(input.id, draft);
      if (proposal?.validation !== "valid") throw new Error("The proposal failed source-preservation checks. Request another proposal.");
      return { revision: proposal.source, explanation: proposal.explanation, questions: proposal.questions, warnings: proposal.warnings };
    });
  }

  const server = createServer(async (req, res) => {
    const address = server.address();
    const expectedHost = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`))
      return json(res, 403, { error: "Forbidden." });
    const url = new URL(req.url ?? "/", `http://${expectedHost}`);
    const route = url.pathname;
    if (req.method === "GET" && route === "/api/session") {
      return json(res, 200, { token, provider: model ? { name: "Cloudflare Workers AI", model: modelId } : null });
    }
    if (req.method === "GET" && route === "/api/revisions") {
      try {
        requireProject(url.searchParams.get("projectId"));
        const activeStore = store;
        const revisions = [];
        for (const id of await activeStore.listDrafts()) {
          try {
            const draft = await activeStore.readDraft(id);
            if (draft?.session)
              revisions.push({
                id,
                path: draft.path,
                original: draft.session.originalSource,
                draft: draft.session.studentDraft,
                draftVersion: draft.session.draftVersion,
              });
          } catch {
            /* A damaged draft must not prevent recovery of other drafts. */
          }
        }
        if (activeStore !== store || url.searchParams.get("projectId") !== projectId)
          throw new Error("The project changed. Open it again.");
        return json(res, 200, { revisions });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "Could not load drafts." });
      }
    }
    if (req.method === "POST") {
      if (
        req.headers.origin !== `http://${expectedHost}` ||
        !tokenMatches(req.headers["x-session-token"], token) ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
      )
        return json(res, 403, { error: "Forbidden." });
      try {
        const input = await bodyJson(req);
        // Keep edits and draft writes ordered. Analysis does not block editing.
        if (route === "/api/analysis") return json(res, 200, await operation(route, input));
        if (route === "/api/revision/proposal") return json(res, 200, await generateProposal(input));
        return json(res, 200, await enqueue(() => operation(route, input)));
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "Operation failed." });
      }
    }
    if (req.method === "GET") {
      const file =
        route === "/"
          ? join(root, "local/workspace.html")
          : route === "/workspace.css"
            ? join(root, "local/workspace.css")
            : route.startsWith("/assets/")
              ? resolve(root, "public", `.${route}`)
              : null;
      if (!file || (route.startsWith("/assets/") && !file.startsWith(join(root, "public", "assets") + sep)))
        return json(res, 404, { error: "Not found." });
      try {
        const data = await readFile(file);
        res.writeHead(200, {
          "content-type": file.endsWith(".html")
            ? "text/html; charset=utf-8"
            : file.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        return res.end(data);
      } catch {
        return json(res, 404, { error: "Not found." });
      }
    }
    return json(res, 404, { error: "Not found." });
  });
  return server;
}

function configuredModel() {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_AI_MODEL } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_AI_MODEL) return null;
  return createCloudflareModel({ accountId: CLOUDFLARE_ACCOUNT_ID, token: CLOUDFLARE_API_TOKEN, model: CLOUDFLARE_AI_MODEL });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createCompanion();
  server.listen(8789, "127.0.0.1", () => process.stdout.write("Thesis Revision Helper: http://127.0.0.1:8789\n"));
}
