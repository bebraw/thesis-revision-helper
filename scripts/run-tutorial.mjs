import { spawn } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function startApp({ root, launch, env, signals, killGroup }) {
  return new Promise((resolveResult, reject) => {
    const child = launch("npm", ["run", "app"], { cwd: root, env, stdio: "inherit", detached: true });
    let interrupted;
    const interrupt = (signal) => {
      interrupted ??= signal;
      if (child.pid) {
        try {
          killGroup(-child.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    };
    const onInterrupt = () => interrupt("SIGINT");
    const onTerminate = () => interrupt("SIGTERM");
    const cleanup = () => {
      signals.off("SIGINT", onInterrupt);
      signals.off("SIGTERM", onTerminate);
    };
    signals.on("SIGINT", onInterrupt);
    signals.on("SIGTERM", onTerminate);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      const stoppedBy = interrupted ?? signal;
      resolveResult(stoppedBy ? 128 + (constants.signals[stoppedBy] ?? 0) : (code ?? 1));
    });
  });
}

export async function runTutorial({
  root = repositoryRoot,
  tempRoot = tmpdir(),
  launch = spawn,
  output = process.stdout,
  env = process.env,
  signals = process,
  killGroup = process.kill,
} = {}) {
  const directory = await mkdtemp(join(resolve(tempRoot), "thesis-revision-demo."));
  await cp(join(root, "examples", "sample-thesis"), directory, { recursive: true });
  output.write(`Project directory: ${directory}\nOpen http://127.0.0.1:8789 and paste this path.\n`);
  return startApp({ root, launch, env, signals, killGroup });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runTutorial();
  } catch (error) {
    process.stderr.write(`Could not start the tutorial: ${error.message}\n`);
    process.exitCode = 1;
  }
}
