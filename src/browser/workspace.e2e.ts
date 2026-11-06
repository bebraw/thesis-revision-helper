import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import typescript from "typescript";

test("edits source and keeps the student draft separate through review and undo", async ({ page }) => {
  const html = await readFile(new URL("../../local/workspace.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../local/workspace.css", import.meta.url), "utf8");
  const sourceCode = await readFile(new URL("./workspace.ts", import.meta.url), "utf8");
  const script = typescript.transpileModule(sourceCode, {
    compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext },
  }).outputText;
  let source = String.raw`\begin{document}Original.\end{document}`;
  let version = "v1";
  let draft = "Original.";
  let draftVersion = 1;
  let hasDraft = false;
  let commits = 0;
  let analysisAvailable = true;
  const snapshot = () => {
    const start = String.raw`\begin{document}`.length;
    const end = source.indexOf(String.raw`\end{document}`);
    const text = source.slice(start, end);
    return {
      projectId: "p1",
      project: "/project",
      files: ["main.tex"],
      path: "main.tex",
      text: source,
      version,
      paragraphs: [{ start, end: start + text.length, text, safe: true }],
      diagnostics: [],
    };
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname === "/assets/browser/workspace.js") return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname === "/api/session")
      return route.fulfill({ json: { token: "local-token", provider: { name: "Cloudflare Workers AI", model: "example-model" } } });
    if (url.pathname === "/api/revisions")
      return route.fulfill({
        json: { revisions: hasDraft ? [{ id: "r1", path: "main.tex", original: "Original.", draft, draftVersion }] : [] },
      });
    if (route.request().headers()["x-session-token"] !== "local-token")
      return route.fulfill({ status: 403, json: { error: "Missing token" } });
    const body: unknown = route.request().postDataJSON();
    if (typeof body !== "object" || body === null || (!("projectId" in body) && url.pathname !== "/api/open")) {
      return route.fulfill({ status: 400, json: { error: "Missing project" } });
    }
    if (url.pathname === "/api/open") return route.fulfill({ json: snapshot() });
    if (url.pathname === "/api/analysis")
      return analysisAvailable
        ? route.fulfill({ json: { purpose: "Introduces the main point.", version } })
        : route.fulfill({ status: 503, json: { error: "Model unavailable" } });
    if (url.pathname === "/api/save" && "text" in body && typeof body.text === "string") {
      source = body.text;
      version = "v4";
      return route.fulfill({ json: snapshot() });
    }
    if (url.pathname === "/api/revision/start") {
      hasDraft = true;
      return route.fulfill({ json: { id: "r1", path: "main.tex", original: "Original.", draft, draftVersion } });
    }
    if (url.pathname === "/api/revision/restore")
      return route.fulfill({ json: { id: "r1", path: "main.tex", original: "Original.", draft, draftVersion } });
    if (url.pathname === "/api/revision/proposal")
      return route.fulfill({ json: { revision: "Suggested wording.", explanation: ["Shortened the sentence."], questions: [] } });
    if (url.pathname === "/api/revision/draft" && "text" in body && typeof body.text === "string") {
      draft = body.text;
      draftVersion += 1;
      return route.fulfill({ json: { draftVersion } });
    }
    if (url.pathname === "/api/revision/commit") {
      commits += 1;
      if (!("reviewToken" in body))
        return route.fulfill({ json: { requiresReview: true, warnings: ["Review the changed citation."], reviewToken: "review" } });
      source = source.replace("Original.", draft);
      version = "v2";
      hasDraft = false;
      return route.fulfill({ json: { ...snapshot(), transactionCommitted: true, undoAvailable: true } });
    }
    if (url.pathname === "/api/revision/undo") {
      source = source.replace(draft, "Original.");
      version = "v3";
      return route.fulfill({ json: snapshot() });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected request" } });
  });

  await page.goto("/");
  await expect(page.getByText("Cloudflare Workers AI · example-model")).toBeVisible();
  const directory = page.getByLabel("Project directory");
  await directory.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Open project" })).toBeFocused();
  await directory.focus();
  await directory.fill("/project");
  await directory.press("Enter");
  await expect(page.getByRole("heading", { name: "Manuscript" })).toBeVisible();
  const editor = page.getByLabel("LaTeX source");
  await expect(editor).toBeEditable();
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByLabel("Your revision")).toHaveValue("Original.");
  await page.getByLabel("Your revision").fill("My own text.");
  await page.getByRole("button", { name: "Generate proposal" }).click();
  await expect(page.getByText("Suggested wording.")).toBeVisible();
  await expect(page.getByLabel("Your revision")).toHaveValue("My own text.");
  await expect(page.getByLabel("LaTeX source")).toHaveValue(/Original\./);
  await page.getByRole("button", { name: "Use my revision" }).click();
  await expect(page.getByText("Review the changed citation.")).toBeVisible();
  expect(commits).toBe(1);
  await expect(editor).toHaveValue(/Original\./);
  await page.getByRole("button", { name: "Commit anyway" }).click();
  await expect(editor).toHaveValue(/My own text\./);
  await page.getByRole("button", { name: "Undo revision" }).click();
  await expect(editor).toHaveValue(/Original\./);
  analysisAvailable = false;
  await page.getByRole("button", { name: /Paragraph 1/ }).click();
  await expect(page.getByText("Analysis unavailable")).toBeVisible();
  await editor.fill(String.raw`\begin{document}Offline edit.\end{document}`);
  await editor.evaluate((node) => {
    if (!(node instanceof HTMLTextAreaElement)) throw new Error("Expected an editor");
    const cursor = node.value.indexOf("Offline") + 3;
    node.setSelectionRange(cursor, cursor);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText("Saved locally")).toBeVisible();
  await editor.press("!");
  await expect(editor).toHaveValue(/Off!line edit\./);
});
