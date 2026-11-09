import { expect, test } from "@playwright/test";

test("serves the thesis workspace directly at the root", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page.getByRole("heading", { level: 1, name: "Thesis Revision Helper" })).toBeVisible();
});

test("keeps the starter page available separately", async ({ page }) => {
  await page.goto("/starter");

  await expect(page.getByRole("heading", { level: 1, name: "vibe-template Worker" })).toBeVisible();
  await expect(
    page.getByText("A runnable Cloudflare Worker baseline with a route index, a health probe, and room for real feature work."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Route Index" })).toBeVisible();
  await expect(page.locator('a[href="/api/health"]').first()).toBeVisible();
});

test("serves the health endpoint", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    name: "vibe-template-worker",
    routes: ["/", "/api/health"],
  });
});

test("serves the generated stylesheet", async ({ request }) => {
  const response = await request.get("/styles.css");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/css");
  await expect(response.text()).resolves.toContain("--color-app-canvas:#f3eee6");
});

test("preserves the legacy workspace URL and its browser module", async ({ page }) => {
  await page.goto("/app/");

  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 1, name: "Thesis Revision Helper" })).toBeVisible();
  const module = await page.request.get("/assets/browser/workspace.js");
  expect(module.ok()).toBe(true);
  expect(module.headers()["content-type"]).toContain("javascript");
});

test("restores a saved working copy when navigating from the legacy workspace URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample" }).click();
  const source = page.getByLabel("LaTeX source");
  await expect(source).toHaveValue(/\\documentclass/);
  const original = await source.inputValue();
  expect(original).toContain("\\documentclass");

  await page.goto("/app/");
  await expect(source).toHaveValue(original);
  expect(new URL(page.url()).pathname).toBe("/");
});
