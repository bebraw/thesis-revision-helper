import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisScheduler, type AnalysisContext } from "./analysis";

const context: AnalysisContext = {
  blockId: "paragraph-1",
  source: "The model reduced latency.",
  dependencies: [{ blockId: "paragraph-1", version: 1, sourceHash: "source-v1" }],
  headingContext: "Results",
  neighbourContext: ["We measured latency."],
  authorNotes: [],
  researchQuestion: "Does the model reduce latency?",
  glossary: [],
  promptVersion: "purpose-v1",
  providerId: "fake",
  modelId: "model-1",
  modelConfiguration: "temperature=0",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("AnalysisScheduler", () => {
  it("waits 1.5 seconds of idle and publishes a validated purpose", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async () => ({ purpose: "Reports a reduction in latency." }));
    const scheduler = new AnalysisScheduler(provider);

    scheduler.update(context);
    expect(scheduler.snapshot.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1499);
    expect(provider).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect(scheduler.snapshot).toMatchObject({
      state: "current",
      result: { purpose: "Reports a reduction in latency." },
    });
    scheduler.dispose();
  });

  it("does not dispatch during input-method composition and starts the idle interval after composition ends", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async () => ({ purpose: "Introduces the finding." }));
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context, { isComposing: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider).not.toHaveBeenCalled();
    scheduler.update(context, { isComposing: false });
    await vi.advanceTimersByTimeAsync(1499);
    expect(provider).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    scheduler.dispose();
  });

  it("rejects an obsolete response even when cancellation does not stop the provider", async () => {
    vi.useFakeTimers();
    let finishOld: (value: unknown) => void = () => {};
    const provider = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ purpose: "Describes the new context." });
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const oldSignal: AbortSignal = provider.mock.calls[0]![1].signal;

    scheduler.update({ ...context, headingContext: "Discussion" });
    expect(oldSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.result?.purpose).toBe("Describes the new context."));
    finishOld({ purpose: "Obsolete purpose." });
    await Promise.resolve();
    expect(scheduler.snapshot).toMatchObject({ state: "current", result: { purpose: "Describes the new context." } });
    scheduler.dispose();
  });

  it("marks previous results stale as soon as any supplied dependency changes", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async () => ({ purpose: "Reports a result." }));
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    const firstDigest = scheduler.snapshot.contextDigest;
    scheduler.update({ ...context, authorNotes: ["Explain the comparison"] });
    expect(scheduler.snapshot).toMatchObject({ state: "stale", result: { purpose: "Reports a result." } });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    expect(scheduler.snapshot.contextDigest).not.toBe(firstDigest);
    expect(scheduler.snapshot.contextDigest).toMatch(/^[0-9a-f]{64}$/);
    scheduler.dispose();
  });

  it("keeps unchanged results without sending the same context again", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async () => ({ purpose: "Reports a result." }));
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    const { source, ...otherFields } = context;
    scheduler.update({ source, ...structuredClone(otherFields) });
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("preserves an unclear interpretation and rejects malformed output", async () => {
    vi.useFakeTimers();
    const provider = vi.fn().mockResolvedValueOnce({ purpose: null }).mockResolvedValueOnce({ purpose: 42 });
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("unclear"));
    scheduler.update({ ...context, source: "Changed.", dependencies: [{ blockId: "paragraph-1", version: 2, sourceHash: "source-v2" }] });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("failed"));
    expect(scheduler.snapshot.result).toEqual({ purpose: null });
    scheduler.dispose();
  });

  it("allows retry of a failed request without changing source", async () => {
    vi.useFakeTimers();
    const provider = vi
      .fn()
      .mockRejectedValueOnce(new Error("private provider details"))
      .mockResolvedValueOnce({ purpose: "Explains the result." });
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("failed"));
    expect(scheduler.snapshot.error).not.toContain("private provider details");
    scheduler.retry();
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    expect(provider).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("retries transient provider failures with bounded backoff", async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];
    const provider = vi.fn(async () => {
      callTimes.push(Date.now());
      if (callTimes.length < 3) throw new Error("unavailable");
      return { purpose: "Describes the result." };
    });
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("failed"));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    expect(provider).toHaveBeenCalledTimes(3);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(1000);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(2000);
    scheduler.dispose();
  });

  it("coalesces edits and keeps the original context isolated from caller mutation", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async (_input: AnalysisContext) => ({ purpose: "Explains the final sentence." }));
    const scheduler = new AnalysisScheduler(provider);
    const next = structuredClone(context);
    scheduler.update(next);
    await vi.advanceTimersByTimeAsync(1000);
    next.source = "Changed after scheduling.";
    scheduler.update({ ...context, source: "The final sentence." });
    await vi.advanceTimersByTimeAsync(1499);
    expect(provider).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect(provider.mock.calls[0]?.[0]).toMatchObject({ source: "The final sentence." });
    scheduler.dispose();
  });

  it("accepts validated optional details and rejects malformed details", async () => {
    vi.useFakeTimers();
    const provider = vi
      .fn()
      .mockResolvedValueOnce({
        purpose: "Interprets the result.",
        keyPoint: "The method is faster.",
        relationToPrevious: { kind: "interprets", explanation: "Builds on the measurement." },
      })
      .mockResolvedValueOnce({ purpose: "Invalid detail", relationToPrevious: { kind: 3 } });
    const scheduler = new AnalysisScheduler(provider);
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    expect(scheduler.snapshot.result?.relationToPrevious?.kind).toBe("interprets");
    scheduler.update({ ...context, source: "A new interpretation." });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("failed"));
    expect(scheduler.snapshot.result?.purpose).toBe("Interprets the result.");
    scheduler.dispose();
  });

  it("notifies subscribers without exposing mutable internal state, and disposal cancels pending work", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async () => ({ purpose: "Reports a result." }));
    const scheduler = new AnalysisScheduler(provider);
    const listener = vi.fn((snapshot) => {
      snapshot.error = "changed by listener";
    });
    const unsubscribe = scheduler.subscribe(listener);
    scheduler.update(context);
    expect(listener).toHaveBeenCalled();
    expect(scheduler.snapshot.error).toBeNull();
    unsubscribe();
    scheduler.dispose();
    scheduler.update({ ...context, source: "Ignored after disposal." });
    await vi.advanceTimersByTimeAsync(2000);
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not schedule an obsolete context when a listener synchronously changes it", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async (_input: AnalysisContext) => ({ purpose: "Current purpose." }));
    const scheduler = new AnalysisScheduler(provider);
    let changed = false;
    scheduler.subscribe(() => {
      if (!changed) {
        changed = true;
        scheduler.update({ ...context, source: "New source." });
      }
    });
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[0].source).toBe("New source.");
    scheduler.dispose();
  });

  it("does not retry an old context when a failure listener switches to a newer one", async () => {
    vi.useFakeTimers();
    const provider = vi.fn(async (input: AnalysisContext) => {
      if (input.source === context.source) throw new Error("unavailable");
      return { purpose: "Current purpose." };
    });
    const scheduler = new AnalysisScheduler(provider);
    scheduler.subscribe((snapshot) => {
      if (snapshot.state === "failed") scheduler.update({ ...context, source: "New source." });
    });
    scheduler.update(context);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(scheduler.snapshot.state).toBe("current"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[0].source).toBe("New source.");
    expect(scheduler.snapshot.state).toBe("current");
    scheduler.dispose();
  });
});
