import assert from "node:assert/strict";
import { link, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ProjectConflictError, ProjectEncodingError, ProjectPathError, ProjectStore } from "../local/project.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "thesis-project-test-"));
  roots.push(root);
  const project = join(root, "project");
  const dataDir = join(root, "data");
  await mkdir(project);
  await writeFile(join(project, "main.tex"), "Original.\r\n");
  return { root, project, dataDir };
}

test("opens a local project and reads source bytes unchanged", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir, rootFile: "main.tex" });
  assert.deepEqual(await store.listFiles(), ["main.tex"]);
  const source = await store.read("main.tex");
  assert.deepEqual(source.bytes, await readFile(join(project, "main.tex")));
  assert.match(source.version, /^[a-f0-9]{64}$/);
});

test("saves exact bytes only when the expected disk version is current", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir });
  const before = await store.read("main.tex");
  const bytes = Buffer.from("Révision 😀.\r\n");
  const saved = await store.save("main.tex", before.version, bytes);
  assert.deepEqual(saved.bytes, bytes);
  assert.deepEqual(await readFile(join(project, "main.tex")), bytes);
  await assert.rejects(store.save("main.tex", before.version, Buffer.from("Outdated")), ProjectConflictError);
  assert.deepEqual(await readFile(join(project, "main.tex")), bytes);
});

test("does not overwrite changes made outside the app between edits", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir });
  const before = await store.read("main.tex");
  await writeFile(join(project, "main.tex"), "External revision.");
  await assert.rejects(store.save("main.tex", before.version, Buffer.from("My revision")), ProjectConflictError);
  assert.equal(await readFile(join(project, "main.tex"), "utf8"), "External revision.");
});

test("does not replace the source inode for an unchanged save", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir });
  const before = await store.read("main.tex");
  const beforeStat = await lstat(join(project, "main.tex"));
  const saved = await store.save("main.tex", before.version, before.bytes);
  assert.equal(saved.version, before.version);
  assert.equal((await lstat(join(project, "main.tex"))).ino, beforeStat.ino);
});

test("rejects traversal and symlinks, including linked ancestor directories", async () => {
  const { project, root, dataDir } = await fixture();
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.tex"), "private");
  await symlink(outside, join(project, "linked"));
  await symlink(join(outside, "secret.tex"), join(project, "linked.tex"));
  const store = await ProjectStore.open(project, { dataDir });
  for (const path of ["../outside/secret.tex", "/etc/passwd", "linked/secret.tex", "linked.tex", "./main.tex", "a//b"]) {
    await assert.rejects(store.read(path), ProjectPathError);
  }
  assert.deepEqual(await store.listFiles(), ["main.tex"]);
  assert.equal(await readFile(join(outside, "secret.tex"), "utf8"), "private");
});

test("rejects a project file hard-linked to another location", async () => {
  const { project, root, dataDir } = await fixture();
  const outside = join(root, "outside.tex");
  await writeFile(outside, "Private content.");
  await link(outside, join(project, "linked.tex"));
  const store = await ProjectStore.open(project, { dataDir });
  await assert.rejects(store.read("linked.tex"), ProjectPathError);
  await assert.rejects(store.save("linked.tex", "untrusted-version", Buffer.from("Replacement")), ProjectPathError);
  assert.equal(await readFile(outside, "utf8"), "Private content.");
});

test("rejects invalid UTF-8 on reading and before saving", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir });
  const original = await store.read("main.tex");
  await assert.rejects(store.save("main.tex", original.version, Buffer.from([0xc3, 0x28])), ProjectEncodingError);
  assert.equal(await readFile(join(project, "main.tex"), "utf8"), "Original.\r\n");
  await writeFile(join(project, "broken.tex"), Buffer.from([0xc3, 0x28]));
  await assert.rejects(store.read("broken.tex"), ProjectEncodingError);
});

test("recovers separate drafts after reopening and removes only a named draft", async () => {
  const { project, dataDir } = await fixture();
  const first = await ProjectStore.open(project, { dataDir });
  await first.saveDraft("draft_1", { text: "My version 😀", source: "main.tex" });
  await first.saveDraft("draft_2", { text: "Other" });
  await first.close();
  const reopened = await ProjectStore.open(project, { dataDir });
  assert.deepEqual(await reopened.listDrafts(), ["draft_1", "draft_2"]);
  assert.deepEqual(await reopened.readDraft("draft_1"), { text: "My version 😀", source: "main.tex" });
  await reopened.removeDraft("draft_1");
  assert.deepEqual(await reopened.listDrafts(), ["draft_2"]);
  assert.equal(await readFile(join(project, "main.tex"), "utf8"), "Original.\r\n");
  await assert.rejects(reopened.saveDraft("../bad", {}), ProjectPathError);
});

test("serializes concurrent saves from the application so only the first snapshot wins", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir });
  const before = await store.read("main.tex");
  const results = await Promise.allSettled([
    store.save("main.tex", before.version, Buffer.from("one")),
    store.save("main.tex", before.version, Buffer.from("two")),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(await readFile(join(project, "main.tex"), "utf8"), "one");
});

test("serializes saves for two store instances of the same project", async () => {
  const { project, dataDir } = await fixture();
  const first = await ProjectStore.open(project, { dataDir });
  const second = await ProjectStore.open(project, { dataDir });
  const before = await first.read("main.tex");
  const results = await Promise.allSettled([
    first.save("main.tex", before.version, Buffer.from("one")),
    second.save("main.tex", before.version, Buffer.from("two")),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(await readFile(join(project, "main.tex"), "utf8"), "one");
});

test("does not store app data inside the opened project or follow a linked draft", async () => {
  const { project, root, dataDir } = await fixture();
  await assert.rejects(ProjectStore.open(project, { dataDir: join(project, "appdata") }), ProjectPathError);
  const store = await ProjectStore.open(project, { dataDir });
  await store.saveDraft("safe", { value: 1 });
  const namespaces = await import("node:fs/promises").then(({ readdir }) => readdir(dataDir));
  const drafts = join(dataDir, namespaces[0], "drafts");
  const external = join(root, "external.json");
  await writeFile(external, '{"private":true}');
  await symlink(external, join(drafts, "link.json"));
  await assert.rejects(store.saveDraft("link", { changed: true }), ProjectPathError);
  assert.equal(await readFile(external, "utf8"), '{"private":true}');
  assert.equal((await lstat(join(drafts, "link.json"))).isSymbolicLink(), true);
});

test("closed stores do not access source or drafts", async () => {
  const { project, dataDir } = await fixture();
  const store = await ProjectStore.open(project, { dataDir });
  await store.close();
  await assert.rejects(store.read("main.tex"), /closed/);
  await assert.rejects(store.saveDraft("draft", {}), /closed/);
});
