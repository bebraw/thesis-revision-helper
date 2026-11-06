import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createCompanion } from "../../local/companion.mjs";

test("edits and revises source through the real local companion", async ({ page }) => {
  execFileSync(process.execPath, [resolve("node_modules/typescript-7/bin/tsc"), "--project", "tsconfig.browser.json"]);
  const temporary = await mkdtemp(join(tmpdir(), "thesis-browser-integration-"));
  const project = join(temporary, "project");
  const dataDir = join(temporary, "data");
  await mkdir(project);
  const thesis = join(project, "thesis.tex");
  const original = "\ufeff\\documentclass{article}\r\n\\begin{document}\r\nThe system processes files \\cite{key}.\r\n\\end{document}\r\n";
  await writeFile(thesis, original);
  const sourceWriteRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["/api/save", "/api/revision/commit", "/api/revision/undo"].includes(path)) sourceWriteRequests.push(path);
  });
  let modelAvailable = true;
  const server = createCompanion({
    dataDir,
    modelId: "deterministic-test-model",
    model: {
      analyse: async () => {
        if (!modelAvailable) throw new Error("Model unavailable");
        return { purpose: "Describes the system's file processing." };
      },
      propose: async () => ({ revision: "The system handles files \\cite{key}.", explanation: ["Simplifies wording."], questions: [] }),
    },
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test companion did not bind to a TCP port.");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByText("Cloudflare Workers AI · deterministic-test-model")).toBeVisible();
    await page.getByLabel("Project directory").fill(project);
    await page.getByRole("button", { name: "Open project" }).click();
    await expect(page.getByLabel("LaTeX source")).toHaveValue(/The system processes files/);
    await expect(page.getByLabel("LaTeX source")).toBeEditable();
    await expect(page.getByRole("button", { name: "Undo revision" })).toBeDisabled();
    await expect(page.getByText("Describes the system's file processing.")).toBeVisible();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    const revision = page.getByLabel("Your revision");
    await expect(revision).toHaveValue("The system processes files \\cite{key}.");
    await revision.fill("The system processes local files \\cite{key}.");
    await page.getByRole("button", { name: "Generate proposal" }).click();
    await expect(page.getByText("The system handles files \\cite{key}.")).toBeVisible();
    await expect(revision).toHaveValue("The system processes local files \\cite{key}.");
    expect(await readFile(thesis, "utf8")).toBe(original);
    await page.getByRole("button", { name: "Use my revision" }).click();
    await expect(page.getByLabel("LaTeX source")).toHaveValue(/The system processes local files/);
    const committed = original.replace("processes files", "processes local files");
    expect(await readFile(thesis, "utf8")).toBe(committed);
    await page.getByRole("button", { name: "Undo revision" }).click();
    await expect(page.getByLabel("LaTeX source")).toHaveValue(/The system processes files/);
    expect(await readFile(thesis, "utf8")).toBe(original);
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await revision.fill("The system processes local files \\cite{key}.");
    await page.getByRole("button", { name: "Return to manuscript" }).click();
    await page.getByRole("button", { name: "Restore draft · thesis.tex" }).click();
    await expect(revision).toHaveValue("The system processes local files \\cite{key}.");
    modelAvailable = false;
    const editor = page.getByLabel("LaTeX source");
    await page.getByRole("button", { name: /Paragraph 1/ }).click();
    await expect(page.getByText("Analysis unavailable")).toBeVisible();
    await page.getByRole("button", { name: "Return to manuscript" }).click();
    await editor.fill(original.slice(1).replace(/\r\n/g, "\n").replace("processes files", "processes offline files"));
    await expect.poll(async () => readFile(thesis, "utf8")).toBe(original.replace("processes files", "processes offline files"));
    expect(sourceWriteRequests).toContain("/api/revision/commit");
    expect(sourceWriteRequests).toContain("/api/revision/undo");
    expect(sourceWriteRequests).toContain("/api/save");
  } finally {
    await page.close();
    if (server.listening)
      await new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    await rm(temporary, { recursive: true, force: true });
  }
});
