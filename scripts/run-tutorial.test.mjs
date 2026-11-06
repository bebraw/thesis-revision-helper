import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runTutorial } from "./run-tutorial.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "tutorial-test."));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sample = join(root, "examples", "sample-thesis");
  await mkdir(sample, { recursive: true });
  await writeFile(join(sample, "main.tex"), "Original sample\n");
  return { root, sample };
}

function launchResult(code, signal = null) {
  return () => {
    const child = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => child.emit("close", code, signal));
    return child;
  };
}

test("creates independent sample copies and starts the app with inherited environment", async (t) => {
  const { root, sample } = await fixture(t);
  const output = [];
  const launches = [];
  const env = { PATH: "/example", CLOUDFLARE_API_TOKEN: "secret" };
  const launch = (command, args, options) => {
    launches.push({ command, args, options });
    return launchResult(0)();
  };
  const options = { root, tempRoot: root, output: { write: (text) => output.push(text) }, launch, env };
  assert.equal(await runTutorial(options), 0);
  assert.equal(await runTutorial(options), 0);
  const paths = output
    .join("")
    .match(/Project directory: (.+)/g)
    .map((line) => line.slice("Project directory: ".length));
  assert.equal(paths.length, 2);
  assert.notEqual(paths[0], paths[1]);
  assert.equal(await readFile(join(paths[0], "main.tex"), "utf8"), "Original sample\n");
  await writeFile(join(paths[0], "main.tex"), "Edited copy\n");
  assert.equal(await readFile(join(sample, "main.tex"), "utf8"), "Original sample\n");
  assert.match(output.join(""), /http:\/\/127\.0\.0\.1:8789/);
  assert.doesNotMatch(output.join(""), /secret/);
  assert.deepEqual(launches[0], {
    command: "npm",
    args: ["run", "app"],
    options: { cwd: root, env, stdio: "inherit", detached: true },
  });
});

test("does not start the app if the sample cannot be copied", async (t) => {
  const { root, sample } = await fixture(t);
  await rm(sample, { recursive: true });
  let launched = false;
  await assert.rejects(runTutorial({ root, tempRoot: root, launch: () => (launched = true) }));
  assert.equal(launched, false);
});

test("returns the application's exit status", async (t) => {
  const { root } = await fixture(t);
  const output = { write() {} };
  assert.equal(await runTutorial({ root, tempRoot: root, output, launch: launchResult(7) }), 7);
  assert.equal(await runTutorial({ root, tempRoot: root, output, launch: launchResult(null, "SIGINT") }), 130);
});

test("reports an app launch failure", async (t) => {
  const { root } = await fixture(t);
  const launch = () => {
    const child = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => child.emit("error", new Error("launch failed")));
    return child;
  };
  await assert.rejects(runTutorial({ root, tempRoot: root, output: { write() {} }, launch }), /launch failed/);
});

test("forwards interrupts to the app process group and removes listeners", async (t) => {
  const { root } = await fixture(t);
  const signals = new EventEmitter();
  const sent = [];
  const child = new EventEmitter();
  child.pid = 12345;
  const result = runTutorial({
    root,
    tempRoot: root,
    output: { write() {} },
    launch: () => child,
    signals,
    killGroup: (pid, signal) => sent.push([pid, signal]),
  });
  while (signals.listenerCount("SIGINT") === 0) await new Promise((resolve) => setImmediate(resolve));
  signals.emit("SIGINT");
  child.emit("close", null, "SIGINT");
  assert.equal(await result, 130);
  assert.deepEqual(sent, [[-12345, "SIGINT"]]);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("the executable resolves the repository from outside its working directory", async (t) => {
  const { root } = await fixture(t);
  const fakeNpm = join(root, "npm");
  await writeFile(fakeNpm, '#!/bin/sh\nprintf "app directory: %s\\n" "$PWD"\nexit 23\n');
  await chmod(fakeNpm, 0o755);
  const entry = fileURLToPath(new URL("./run-tutorial.mjs", import.meta.url));
  const result = await new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry],
      { cwd: root, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TMPDIR: root } },
      (error, stdout) => resolve({ error, stdout }),
    );
  });
  assert.equal(result.error.code, 23);
  assert.match(result.stdout, /Project directory: /);
  assert.ok(result.stdout.includes(`app directory: ${resolve(fileURLToPath(new URL("..", import.meta.url)))}`));
});
