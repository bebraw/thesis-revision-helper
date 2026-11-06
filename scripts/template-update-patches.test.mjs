import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const updatesRoot = join(repoRoot, ".template", "updates");
const unifiedHunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

function collectHunkHeaders(lines) {
  return lines.map((line, index) => ({ index, line, lineNumber: index + 1 })).filter(({ line }) => line.startsWith("@@"));
}

function readExpectedLineCounts(match) {
  return {
    old: match[2] === undefined ? 1 : Number(match[2]),
    new: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function countBodyLine(line, counts) {
  const prefix = line[0] ?? " ";

  if (prefix === " " || prefix === "-") counts.old += 1;
  if (prefix === " " || prefix === "+") counts.new += 1;
}

function countHunkBody(lines, headerIndex, expected) {
  const counts = { old: 0, new: 0 };

  for (const line of lines.slice(headerIndex + 1)) {
    if (line.startsWith("@@") || line.startsWith("diff --git ")) break;
    if (line === "\\ No newline at end of file") continue;
    if (line === "" && counts.old >= expected.old && counts.new >= expected.new) break;

    countBodyLine(line, counts);
  }

  return counts;
}

function validateHunk(lines, header, displayPath) {
  const match = unifiedHunkHeader.exec(header.line);

  if (!match) {
    return [`${displayPath}:${header.lineNumber}: malformed hunk header ${JSON.stringify(header.line)}`];
  }

  const expected = readExpectedLineCounts(match);
  const actual = countHunkBody(lines, header.index, expected);

  if (actual.old === expected.old && actual.new === expected.new) return [];

  return [
    `${displayPath}:${header.lineNumber}: hunk declares ${expected.old}/${expected.new} old/new lines but contains ${actual.old}/${actual.new}`,
  ];
}

function validateHunks(lines, displayPath) {
  const headers = collectHunkHeaders(lines);

  if (headers.length === 0) return [`${displayPath}: missing unified-diff hunk headers`];

  return headers.flatMap((header) => validateHunk(lines, header, displayPath));
}

function validateGitParsing(patchPath, displayPath) {
  const result = spawnSync("git", ["apply", "--numstat", patchPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status === 0) return [];

  return [`${displayPath}: ${result.stderr.trim() || "git could not parse the patch"}`];
}

async function validatePatch(updateId) {
  const patchPath = join(updatesRoot, updateId, "patch.diff");
  const displayPath = relative(repoRoot, patchPath);
  const patch = await readFile(patchPath, "utf8");

  return [...validateHunks(patch.split("\n"), displayPath), ...validateGitParsing(patchPath, displayPath)];
}

test("all template update patches are valid unified diffs", async () => {
  const entries = await readdir(updatesRoot, { withFileTypes: true });
  const updateIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const failures = (await Promise.all(updateIds.map(validatePatch))).flat();

  assert.deepEqual(failures, []);
});
