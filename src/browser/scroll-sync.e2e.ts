import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import typescript from "typescript";

test("tracks the visible paragraph without changing the selected revision target", async ({ page }) => {
  const html = await readFile(new URL("../../local/workspace.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../local/workspace.css", import.meta.url), "utf8");
  const modules = new Map<string, string>();
  for (const name of ["workspace", "scroll-sync"]) {
    const code = await readFile(new URL(`./${name}.ts`, import.meta.url), "utf8");
    modules.set(
      `/assets/browser/${name}.js`,
      typescript.transpileModule(code, {
        compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext },
      }).outputText,
    );
  }
  const prefix = "\\begin{document}\n";
  const suffix = "\n\\end{document}";
  const passages = [
    "First paragraph 😀 explains the approach. ".repeat(100),
    "Second paragraph explains the implementation. ".repeat(100),
    "Third paragraph interprets the results. ".repeat(100),
  ];
  let source = prefix + passages.join("\n\n") + suffix;
  let version = 1;
  let analysisCount = 0;
  const snapshot = () => {
    const parts = source.slice(prefix.length, -suffix.length).split("\n\n");
    let start = prefix.length;
    const paragraphs = parts.map((text) => {
      const paragraph = { start, end: start + text.length, text, safe: true };
      start = paragraph.end + 2;
      return paragraph;
    });
    return {
      projectId: "p1",
      project: "/project",
      files: ["main.tex"],
      path: "main.tex",
      text: source,
      version: `v${version}`,
      paragraphs,
      diagnostics: [],
    };
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css });
    const module = modules.get(url.pathname);
    if (module) return route.fulfill({ contentType: "text/javascript", body: module });
    if (url.pathname === "/api/session") return route.fulfill({ json: { token: "local-token", provider: null } });
    if (url.pathname === "/api/revisions") return route.fulfill({ json: { revisions: [] } });
    if (url.pathname === "/api/open") return route.fulfill({ json: snapshot() });
    if (url.pathname === "/api/analysis") {
      analysisCount += 1;
      return route.fulfill({ json: { purpose: "Explains the passage.", version: `v${version}` } });
    }
    if (url.pathname === "/api/save") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body !== "object" || body === null || !("text" in body) || typeof body.text !== "string") {
        return route.fulfill({ status: 400, json: { error: "Missing source" } });
      }
      source = body.text;
      version += 1;
      return route.fulfill({ json: snapshot() });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected request" } });
  });

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await page.getByLabel("Project directory").fill("/project");
  await page.getByRole("button", { name: "Open project" }).click();
  const editor = page.getByLabel("LaTeX source");
  const first = page.getByRole("button", { name: /Paragraph 1/ });
  const second = page.getByRole("button", { name: /Paragraph 2/ });
  const third = page.getByRole("button", { name: /Paragraph 3/ });
  await expect(editor).toBeEditable();
  await expect(first).toHaveAttribute("aria-current", "location");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Current · AI interpretation")).toBeVisible();
  const initialAnalysisCount = analysisCount;

  await editor.focus();
  const selection = await editor.evaluate((node) => {
    if (!(node instanceof HTMLTextAreaElement)) throw new Error("Expected a textarea");
    node.setSelectionRange(20, 20);
    node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
    node.dispatchEvent(new Event("scroll"));
    return node.selectionStart;
  });
  await expect(second).toHaveAttribute("aria-current", "location");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(selection);
  await page.waitForTimeout(1700);
  expect(analysisCount).toBe(initialAnalysisCount);

  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect(third).toHaveAttribute("aria-current", "location");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(third).toHaveAttribute("aria-current", "location");

  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe(passages[1]);

  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.setRangeText("Edited ", node.selectionStart, node.selectionStart, "end");
    node.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  await expect(page.locator("#outline [aria-current=location]")).toHaveCount(0);
  await editor.evaluate((node: HTMLTextAreaElement) => node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await expect(page.getByText("Saved locally")).toBeVisible();
  await expect(page.locator("#outline [aria-current=location]")).toHaveCount(1);
});
