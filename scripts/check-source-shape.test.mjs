import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectSourceShape } from "./check-source-shape.mjs";

const baseConfig = {
  directoryExceptions: {},
  excludeSuffixes: [".test.ts", ".d.ts"],
  extensions: [".ts"],
  fileExceptions: {},
  maxDirectoryFiles: 2,
  maxFileLines: 4,
  sourceRoots: ["src"],
};

test("reports oversized source files and crowded direct directories", async (context) => {
  const root = await createFixture(context);
  await writeFixture(root, "src/feature/large.ts", "one\ntwo\nthree\nfour\nfive\n");
  await writeFixture(root, "src/feature/second.ts", "export {};\n");
  await writeFixture(root, "src/feature/third.ts", "export {};\n");

  const result = await inspectSourceShape({ config: baseConfig, repoRoot: root });

  assert.deepEqual(result.fileViolations, [{ lines: 5, limit: 4, path: "src/feature/large.ts" }]);
  assert.deepEqual(result.directoryViolations, [{ files: 3, limit: 2, path: "src/feature" }]);
});

test("ignores test files and counts directory files without recursing", async (context) => {
  const root = await createFixture(context);
  await writeFixture(root, "src/feature/first.ts", "export {};\n");
  await writeFixture(root, "src/feature/first.test.ts", "one\ntwo\nthree\nfour\nfive\n");
  await writeFixture(root, "src/feature/nested/second.ts", "export {};\n");
  await writeFixture(root, "src/feature/nested/third.ts", "export {};\n");

  const result = await inspectSourceShape({ config: baseConfig, repoRoot: root });

  assert.deepEqual(result, { directoryViolations: [], fileViolations: [] });
});

test("honors exact exceptions that include a rationale", async (context) => {
  const root = await createFixture(context);
  await writeFixture(root, "src/feature/large.ts", "one\ntwo\nthree\nfour\nfive\n");

  const result = await inspectSourceShape({
    config: {
      ...baseConfig,
      fileExceptions: { "src/feature/large.ts": "Checked-in protocol table" },
    },
    repoRoot: root,
  });

  assert.deepEqual(result.fileViolations, []);
});

test("rejects exceptions without a rationale", async (context) => {
  const root = await createFixture(context);

  await assert.rejects(
    inspectSourceShape({
      config: { ...baseConfig, directoryExceptions: { "src/feature": "" } },
      repoRoot: root,
    }),
    /directoryExceptions.*src\/feature.*rationale/,
  );
});

async function createFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "vibe-source-shape-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function writeFixture(root, path, source) {
  const absolutePath = join(root, path);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, source);
}
