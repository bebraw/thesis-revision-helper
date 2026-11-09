import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import typescript from "typescript";

test("tracks the visible paragraph without changing the selected revision target", async ({ page }) => {
  const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../public/workspace.css", import.meta.url), "utf8");
  const passages = [
    "First paragraph 😀 explains the approach. ".repeat(100),
    "Second paragraph explains the implementation. ".repeat(100),
    "Third paragraph interprets the results. ".repeat(100),
  ];
  const source = "\\begin{document}\n" + passages.join("\n\n") + "\n\\end{document}";
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js")) {
      const name = url.pathname.slice("/assets/".length).replace(/\.js$/, ".ts");
      const code = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
      const script = typescript.transpileModule(code, {
        compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext },
      }).outputText;
      return route.fulfill({ contentType: "text/javascript", body: script });
    }
    return route.abort();
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await page.getByLabel("Copy one file from your editor and paste it here.").fill(source);
  await page.getByRole("button", { name: "Open pasted text" }).click();
  const editor = page.getByLabel("LaTeX source");
  const first = page.getByRole("button", { name: /Paragraph 1/ });
  const second = page.getByRole("button", { name: /Paragraph 2/ });
  const third = page.getByRole("button", { name: /Paragraph 3/ });
  await expect(editor).toBeEditable();
  await expect(first).toHaveAttribute("aria-current", "location");
  await expect(first).toHaveAttribute("aria-pressed", "true");

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

  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect(third).toHaveAttribute("aria-current", "location");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator("#outline .outline-item").nth(2)).toHaveAttribute("aria-current", "location");
  await page.getByRole("button", { name: "Outline & feedback" }).click();
  await expect(third).toHaveAttribute("aria-current", "location");

  await second.click();
  await expect(editor).toBeVisible();
  await expect(page.locator("#outline .outline-item").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe(
    passages[1]?.trimEnd(),
  );
  await page.getByRole("button", { name: "Outline & feedback" }).click();
  await page.getByRole("button", { name: "Show paragraph in manuscript" }).click();
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe(
    passages[1]?.trimEnd(),
  );

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
