import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function stopProcessGroup(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function checkWorkspace(command, args) {
  const port = await availablePort();
  let inspectorPort = await availablePort();
  while (inspectorPort === port) inspectorPort = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  const child = spawn("npm", [...args, "--", "--port", String(port), "--inspector-port", String(inspectorPort)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited = false;
  child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.once("exit", () => (exited = true));

  try {
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`${command} exited before the workspace became available:\n${output}`);
      let response;
      try {
        response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1000) });
      } catch {
        // Startup can take several seconds while Wrangler builds the browser assets.
      }
      if (response?.ok && output.includes(`http://127.0.0.1:${port}`)) {
        assert.match(await response.text(), /<h1>Thesis Revision Helper<\/h1>/);
        return;
      }
      await delay(200);
    }
    assert.fail(`${command} did not announce and serve ${url}:\n${output}`);
  } finally {
    if (!exited && child.pid) stopProcessGroup(child.pid);
    await closed;
  }
}

test("npm start announces and serves the thesis workspace", { timeout: 45_000 }, async () => {
  await checkWorkspace("npm start", ["start"]);
});

test("npm run app announces and serves the thesis workspace", { timeout: 45_000 }, async () => {
  await checkWorkspace("npm run app", ["run", "app"]);
});
