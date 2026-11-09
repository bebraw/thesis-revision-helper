import { describe, expect, it, vi } from "vitest";
import { createLocalModel } from "./local-model";

const endpoint = "http://127.0.0.1:1234/v1/chat/completions";
const completion = (content: string) => Response.json({ choices: [{ message: { content } }] });

describe("browser local model", () => {
  it("sends a paragraph to the configured local model and returns its purpose", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      completion('{"purpose":"Introduces the method.","tips":["Clarify which samples were included."]}'),
    );
    const model = createLocalModel({ endpoint, model: "local-model", fetcher });
    await expect(model.analyse("The method.", "Methods section")).resolves.toEqual({
      purpose: "Introduces the method.",
      tips: ["Clarify which samples were included."],
    });
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(endpoint);
    expect(options?.credentials).toBe("omit");
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("local-model");
    expect(body.messages[1].content).toContain("The method.");
    expect(body.messages[1].content).toContain("Methods section");
  });

  it("accepts a missing tips list as no feedback", async () => {
    const model = createLocalModel({ endpoint, model: "model", fetcher: async () => completion('{"purpose":null}') });
    await expect(model.analyse("Text.", "Context")).resolves.toEqual({ purpose: null, tips: [] });
  });

  it.each([
    '{"purpose":"Describes a method.","tips":[42]}',
    '{"purpose":"Describes a method.","tips":[" "]}',
    '{"purpose":"Describes a method.","tips":["One","Two","Three","Four"]}',
  ])("rejects malformed selected-paragraph feedback", async (content) => {
    const model = createLocalModel({ endpoint, model: "model", fetcher: async () => completion(content) });
    await expect(model.analyse("Text.", "Context")).rejects.toThrow("Model request failed");
  });

  it("returns a validated proposal separately from the student's text", async () => {
    const fetcher = async () => completion('{"revision":"Clear text.","explanation":["Clarified."],"questions":[]}');
    const model = createLocalModel({ endpoint, model: "local-model", fetcher });
    await expect(model.propose("Text.", "Context", "clarity")).resolves.toEqual({
      revision: "Clear text.",
      explanation: ["Clarified."],
      questions: [],
    });
  });

  it("rejects a malformed proposal and an oversized response", async () => {
    const malformed = createLocalModel({
      endpoint,
      model: "model",
      fetcher: async () => completion('{"revision":"Text","explanation":[42],"questions":[]}'),
    });
    await expect(malformed.propose("Text", "Context", "language")).rejects.toThrow("Model request failed");
    const oversized = createLocalModel({ endpoint, model: "model", fetcher: async () => new Response("x".repeat(1_000_001)) });
    await expect(oversized.analyse("Text", "Context")).rejects.toThrow("Model request failed");
  });

  it.each([
    "https://example.com/v1/chat/completions",
    "http://localhost.evil.test/v1/chat/completions",
    "http://user:pass@localhost/v1/chat/completions",
    "file:///tmp/model",
  ])("rejects a non-local or credential-bearing endpoint", (url) => {
    expect(() => createLocalModel({ endpoint: url, model: "model" })).toThrow("Invalid model configuration");
  });

  it.each([
    () => new Response("provider details", { status: 503 }),
    () => completion("not json"),
    () => completion('{"purpose":42}'),
    () => Response.json({ choices: [] }),
  ])("rejects provider errors and malformed responses without leaking their contents", async (response) => {
    const model = createLocalModel({ endpoint, model: "model", fetcher: async () => response() });
    await expect(model.analyse("private manuscript", "context")).rejects.toThrow("Model request failed");
  });

  it("propagates caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new Error("cancelled");
    });
    const model = createLocalModel({ endpoint, model: "model", fetcher });
    await expect(model.analyse("text", "context", controller.signal)).rejects.toThrow("Model request failed");
  });
});
