import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("revises a pasted manuscript with a local model and restores browser state", async ({ page }) => {
  const temporary = await mkdtemp(join(tmpdir(), "thesis-browser-integration-"));
  const thesis = join(temporary, "thesis.tex");
  const original = "\\documentclass{article}\n\\begin{document}\nThe system processes files \\cite{key}.\n\\end{document}\n";
  await writeFile(thesis, original);
  const unexpectedWrites: string[] = [];
  let modelAvailable = true;
  let modelRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && url.port !== "1234") unexpectedWrites.push(request.url());
  });
  await page.route("http://127.0.0.1:1234/v1/chat/completions", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-allow-private-network": "true",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    modelRequests += 1;
    if (!modelAvailable) return route.fulfill({ status: 503, headers, body: "unavailable" });
    const request: unknown = route.request().postDataJSON();
    const isProposal = JSON.stringify(request).includes("Offer one");
    const result = isProposal
      ? { revision: "The system handles files \\cite{key}.", explanation: ["Simplifies wording."], questions: [] }
      : { purpose: "Describes the system's file processing." };
    return route.fulfill({ headers, json: { choices: [{ message: { content: JSON.stringify(result) } }] } });
  });
  try {
    await page.goto("/app/");
    await page.getByLabel("Copy one file from your editor and paste it here.").fill(original);
    await page.getByRole("button", { name: "Open pasted text" }).click();
    const editor = page.getByLabel("LaTeX source");
    await expect(editor).toHaveValue(original);
    await page.getByText("AI connection").click();
    await page.getByLabel("Model name").fill("deterministic-test-model");
    await page.getByRole("button", { name: "Use model" }).click();
    await expect(page.getByText("Describes the system's file processing.")).toBeVisible();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    const revision = page.getByLabel("Your revision");
    await expect(revision).toHaveValue("The system processes files \\cite{key}.");
    await revision.fill("The system processes local files \\cite{key}.");
    await page.getByRole("button", { name: "Generate proposal" }).click();
    await expect(page.getByText("The system handles files \\cite{key}.")).toBeVisible();
    await expect(revision).toHaveValue("The system processes local files \\cite{key}.");
    await expect(editor).toHaveValue(original);
    expect(await readFile(thesis, "utf8")).toBe(original);
    await page.getByRole("button", { name: "Use my revision" }).click();
    await expect(editor).toHaveValue(original.replace("processes files", "processes local files"));
    await page.getByRole("button", { name: "Undo revision" }).click();
    await expect(editor).toHaveValue(original);
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await revision.fill("The system processes local files \\cite{key}.");
    await page.getByRole("button", { name: "Return to manuscript" }).click();
    await page.reload();
    await expect(editor).toHaveValue(original);
    await page.getByRole("button", { name: /Restore draft/ }).click();
    await expect(revision).toHaveValue("The system processes local files \\cite{key}.");
    await page.getByRole("button", { name: "Return to manuscript" }).click();
    modelAvailable = false;
    await page.getByRole("button", { name: /Paragraph 1/ }).click();
    await expect(page.getByText("Analysis unavailable")).toBeVisible();
    const offline = original.replace("processes files", "processes offline files");
    await editor.fill(offline);
    await expect(page.getByText("Saved locally")).toBeVisible();
    await page.reload();
    await expect(editor).toHaveValue(offline);
    expect(await readFile(thesis, "utf8")).toBe(original);
    expect(modelRequests).toBeGreaterThan(1);
    expect(unexpectedWrites).toEqual([]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
