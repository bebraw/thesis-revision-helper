import { expect, test } from "@playwright/test";

test("organizes paragraphs under headings and shows feedback for the selected passage", async ({ page }) => {
  let available = true;
  const text = String.raw`\begin{document}
An opening paragraph.

\section{Method}
The method is described here.

\subsection{Sampling}
Participants were selected carefully.

\section{Results}
The outcome is presented here.
\end{document}`;
  await page.route("http://127.0.0.1:1234/v1/chat/completions", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-allow-private-network": "true",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (!available) return route.fulfill({ status: 503, headers });
    return route.fulfill({
      headers,
      json: {
        choices: [{ message: { content: JSON.stringify({ purpose: "Explains the method.", tips: ["Clarify the sampling criteria."] }) } }],
      },
    });
  });

  await page.goto("/");
  await page.getByLabel("Copy one file from your editor and paste it here.").fill(text);
  await page.getByRole("button", { name: "Open pasted text" }).click();
  const outline = page.getByRole("navigation", { name: "Manuscript outline" });
  const method = outline.getByRole("button", { name: "Method", exact: true });
  const sampling = outline.getByRole("button", { name: "Sampling", exact: true });
  await expect(method).toBeVisible();
  await expect(sampling).toBeVisible();
  await expect(method.locator("xpath=..")).toContainText("Sampling");
  await expect(outline.getByRole("button", { name: /Paragraph 1/ })).toBeVisible();

  await page.getByText("AI connection").click();
  await page.getByLabel("Model name").fill("local-test-model");
  await page.getByRole("button", { name: "Use model" }).click();
  await outline.getByRole("button", { name: /Paragraph 2/ }).click();
  const feedback = page.getByRole("region", { name: "Selected paragraph feedback" });
  await expect(feedback).toContainText("Explains the method.");
  await expect(feedback).toContainText("Clarify the sampling criteria.");
  await expect(feedback.getByRole("button", { name: "Language" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Show current passage" })).toBeVisible();
  available = false;
  await page.getByLabel("Model name").fill("different-local-model");
  await page.getByRole("button", { name: "Use model" }).click();
  await expect(feedback).toContainText("Analysis unavailable");
  await expect(feedback).not.toContainText("Clarify the sampling criteria.");
  await expect(feedback).not.toContainText("Explains the method.");
});

test("keeps heading-only documents navigable and disables stale ranges while composing", async ({ page }) => {
  const text = String.raw`\begin{document}
\section{Method}
\subsection{Sampling}
\end{document}`;
  await page.goto("/");
  await page.getByLabel("Copy one file from your editor and paste it here.").fill(text);
  await page.getByRole("button", { name: "Open pasted text" }).click();
  const editor = page.getByLabel("LaTeX source");
  const outline = page.getByRole("navigation", { name: "Manuscript outline" });
  const heading = outline.getByRole("button", { name: "Method", exact: true });
  await heading.click();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe(
    String.raw`\section{Method}`,
  );
  await expect(page.getByRole("button", { name: "Show paragraph in manuscript" })).toBeDisabled();
  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.setRangeText("Changed", node.selectionEnd, node.selectionEnd, "end");
    node.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  await expect(heading).toBeDisabled();
  await editor.evaluate((node: HTMLTextAreaElement) => node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await expect(page.getByText("Saved locally")).toBeVisible();
});
