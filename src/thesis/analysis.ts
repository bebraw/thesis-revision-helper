export interface AnalysisDependency {
  blockId: string;
  version: number;
  sourceHash: string;
  purposeRevision?: string;
}

/** Every input sent to the provider is included in the context digest. */
export interface AnalysisContext {
  blockId: string;
  source: string;
  dependencies: AnalysisDependency[];
  headingContext: string;
  neighbourContext: string[];
  authorNotes: string[];
  researchQuestion: string;
  glossary: string[];
  promptVersion: string;
  providerId: string;
  modelId: string;
  modelConfiguration: string;
}

export interface AnalysisResult {
  purpose: string | null;
  keyPoint?: string;
  relationToPrevious?: { kind: string; explanation: string };
}

export interface AnalysisSnapshot {
  state: "pending" | "current" | "stale" | "unclear" | "failed";
  result: AnalysisResult | null;
  contextDigest: string | null;
  error: string | null;
}

export type AnalysisProvider = (context: AnalysisContext, request: { contextDigest: string; signal: AbortSignal }) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateResult(value: unknown): AnalysisResult | null {
  if (!isRecord(value) || !(value.purpose === null || (typeof value.purpose === "string" && value.purpose.trim().length > 0))) {
    return null;
  }
  const result: AnalysisResult = { purpose: value.purpose };
  if (value.keyPoint !== undefined) {
    if (typeof value.keyPoint !== "string") return null;
    result.keyPoint = value.keyPoint;
  }
  if (value.relationToPrevious !== undefined) {
    const relation = value.relationToPrevious;
    if (!isRecord(relation) || typeof relation.kind !== "string" || typeof relation.explanation !== "string") return null;
    result.relationToPrevious = { kind: relation.kind, explanation: relation.explanation };
  }
  return result;
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyContext(context: AnalysisContext): AnalysisContext {
  return {
    blockId: context.blockId,
    source: context.source,
    dependencies: context.dependencies.map((dependency) => ({
      blockId: dependency.blockId,
      version: dependency.version,
      sourceHash: dependency.sourceHash,
      ...(dependency.purposeRevision === undefined ? {} : { purposeRevision: dependency.purposeRevision }),
    })),
    headingContext: context.headingContext,
    neighbourContext: [...context.neighbourContext],
    authorNotes: [...context.authorNotes],
    researchQuestion: context.researchQuestion,
    glossary: [...context.glossary],
    promptVersion: context.promptVersion,
    providerId: context.providerId,
    modelId: context.modelId,
    modelConfiguration: context.modelConfiguration,
  };
}

/** One instance tracks one block. Provider calls receive a detached input snapshot. */
export class AnalysisScheduler {
  private current: AnalysisSnapshot = { state: "pending", result: null, contextDigest: null, error: null };
  private context: AnalysisContext | null = null;
  private contextKey: string | null = null;
  private composing = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private listeners = new Set<(snapshot: AnalysisSnapshot) => void>();
  private disposed = false;

  constructor(private readonly provider: AnalysisProvider) {}

  get snapshot(): AnalysisSnapshot {
    return structuredClone(this.current);
  }

  subscribe(listener: (snapshot: AnalysisSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(context: AnalysisContext, options: { isComposing?: boolean } = {}): void {
    if (this.disposed) return;
    const saved = copyContext(context);
    const key = JSON.stringify(saved);
    const composing = options.isComposing === true;
    if (key === this.contextKey && composing === this.composing) return;

    this.cancel();
    this.context = saved;
    this.contextKey = key;
    this.composing = composing;
    const generation = this.generation;
    this.publish({ ...this.current, state: this.current.result === null ? "pending" : "stale", error: null });
    if (!composing && generation === this.generation && !this.disposed) {
      this.timer = setTimeout(() => void this.dispatch(saved, key, generation), 1500);
    }
  }

  retry(): void {
    if (this.disposed || this.composing || this.current.state !== "failed" || this.context === null) return;
    const context = this.context;
    this.contextKey = null;
    this.update(context);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  }

  private cancel(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private publish(snapshot: AnalysisSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private async dispatch(context: AnalysisContext, key: string, generation: number, attempt = 0): Promise<void> {
    if (generation !== this.generation || this.disposed) return;
    this.timer = null;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ ...this.current, state: "pending", error: null });
    if (generation !== this.generation || this.disposed) return;
    try {
      const contextDigest = await digest(key);
      if (generation !== this.generation || this.disposed) return;
      const response = await this.provider(structuredClone(context), { contextDigest, signal: controller.signal });
      if (generation !== this.generation || this.disposed) return;
      const result = validateResult(response);
      if (result === null) {
        this.publish({ ...this.current, state: "failed", error: "Analysis returned an invalid response. Try again." });
        return;
      }
      this.publish({ state: result.purpose === null ? "unclear" : "current", result, contextDigest, error: null });
    } catch {
      if (generation !== this.generation || this.disposed) return;
      this.publish({ ...this.current, state: "failed", error: "Analysis failed. Try again." });
      if (attempt < 2 && generation === this.generation && !this.disposed) {
        this.timer = setTimeout(() => void this.dispatch(context, key, generation, attempt + 1), 1000 * 2 ** attempt);
      }
    }
  }
}
