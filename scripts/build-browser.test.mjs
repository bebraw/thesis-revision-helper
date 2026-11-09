import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("browser build removes output for deleted source modules", () => {
  const root = mkdtempSync(join(tmpdir(), "thesis-browser-build-"));
  try {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { "build:browser": packageJson.scripts["build:browser"] } }));
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "public", "keep.txt"), "Authored static asset");
    writeFileSync(join(root, "src", "current.ts"), "export const current = 1;\n");
    writeFileSync(join(root, "src", "old.ts"), "export const old = 1;\n");
    writeFileSync(
      join(root, "tsconfig.browser.json"),
      JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "public/assets", types: [] }, include: ["src/*.ts"] }),
    );
    const build = () => spawnSync("npm", ["run", "build:browser"], { cwd: root, encoding: "utf8" });
    const first = build();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.ok(existsSync(join(root, "public", "assets", "old.js")));
    rmSync(join(root, "src", "old.ts"));

    const second = build();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(existsSync(join(root, "public", "assets", "old.js")), false);
    assert.ok(existsSync(join(root, "public", "assets", "current.js")));
    assert.equal(readFileSync(join(root, "public", "keep.txt"), "utf8"), "Authored static asset");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
