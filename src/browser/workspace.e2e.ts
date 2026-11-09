import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import typescript from "typescript";

test("pastes and recovers a working copy, protects it from sample replacement, and copies it back", async ({ page }) => {
  const html = await readFile(new URL("../../public/app/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../public/workspace.css", import.meta.url), "utf8");
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js")) {
      const name = url.pathname.slice("/assets/".length).replace(/\.js$/, ".ts");
      const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
      const script = typescript.transpileModule(source, {
        compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext },
      }).outputText;
      return route.fulfill({ contentType: "text/javascript", body: script });
    }
    return route.abort();
  });
  await page.goto("/");
  const text = String.raw`\begin{document}Original.\end{document}`;
  await page.getByLabel("Copy one file from your editor and paste it here.").fill(text);
  await page.getByRole("button", { name: "Open pasted text" }).click();
  const source = page.getByLabel("LaTeX source");
  await expect(source).toHaveValue(text);
  const edited = String.raw`\begin{document}My edited text.\end{document}`;
  await source.fill(edited);
  await expect(page.getByText("Saved locally")).toBeVisible();
  await page.reload();
  await expect(source).toHaveValue(edited);
  await page.getByText("Paste a LaTeX document").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Try the sample" }).click();
  await expect(source).toHaveValue(edited);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Try the sample" }).click();
  await expect(source).toHaveValue(/fictional study/);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await page.getByRole("button", { name: "Copy source" }).click();
  await expect(page.getByText("Source selected. Copy it with your keyboard and paste it into your LaTeX file.")).toBeVisible();
  const selection = await source.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd));
  expect(selection).toContain("fictional study");
  await page.evaluate(() => localStorage.setItem("thesis-revision-helper.workspace.v1", "damaged but potentially recoverable"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("saved workspace could not be read");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Try the sample" }).click();
  expect(await page.evaluate(() => localStorage.getItem("thesis-revision-helper.workspace.v1"))).toBe(
    "damaged but potentially recoverable",
  );
});
