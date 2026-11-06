import { describe, expect, it, vi } from "vitest";
import { createCloudflareModel } from "./cloudflare-model";

describe("Cloudflare model gateway", () => {
  it("sends a bounded request to Workers AI and validates a purpose response", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ success: true, result: { response: '{"purpose":"Explains the experiment."}' } }),
    );
    const model = createCloudflareModel({ accountId: "abc123", token: "local-secret", model: "@cf/test/model", fetcher });
    await expect(model.analyse("A paragraph.", "Section")).resolves.toEqual({ purpose: "Explains the experiment." });
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/test/model");
    expect(options?.headers).toEqual({ authorization: "Bearer local-secret", "content-type": "application/json" });
    expect(JSON.parse(String(options?.body)).messages[1].content).toContain("A paragraph.");
  });

  it("returns a separately validated proposal", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        result: { response: { revision: "A clearer sentence.", explanation: ["Clarifies the sentence."], questions: [] } },
      }),
    );
    const model = createCloudflareModel({ accountId: "abc123", token: "secret", model: "@cf/test/model", fetcher });
    await expect(model.propose("A sentence.", "Section", "clarity")).resolves.toEqual({
      revision: "A clearer sentence.",
      explanation: ["Clarifies the sentence."],
      questions: [],
    });
  });

  it("reports unclear interpretation rather than inventing a purpose", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, result: { response: { purpose: null } } }));
    const model = createCloudflareModel({ accountId: "abc123", token: "secret", model: "@cf/test/model", fetcher });
    await expect(model.analyse("unclear", "context")).resolves.toEqual({ purpose: null });
  });

  it("propagates cancellation to the provider", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new Error("aborted");
    });
    const controller = new AbortController();
    controller.abort();
    const model = createCloudflareModel({ accountId: "abc123", token: "secret", model: "@cf/test/model", fetcher });
    await expect(model.analyse("text", "context", controller.signal)).rejects.toThrow("Model request failed");
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it.each([
    Response.json({ success: true, result: { response: "not json" } }),
    Response.json({ success: true, result: { response: '{"purpose":42}' } }),
    Response.json({ success: false }),
    new Response("error", { status: 503 }),
  ])("rejects malformed or failed provider output", async (response) => {
    const model = createCloudflareModel({ accountId: "abc123", token: "secret", model: "@cf/test/model", fetcher: async () => response });
    await expect(model.analyse("text", "context")).rejects.toThrow("Model request failed");
  });

  it("rejects invalid credentials or model paths before making a request", () => {
    expect(() => createCloudflareModel({ accountId: "../escape", token: "secret", model: "@cf/test/model" })).toThrow();
    expect(() => createCloudflareModel({ accountId: "abc", token: "", model: "@cf/test/model" })).toThrow();
    expect(() => createCloudflareModel({ accountId: "abc", token: "secret", model: "https://evil.example" })).toThrow();
  });
});
