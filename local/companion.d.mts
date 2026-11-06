import type { Server } from "node:http";

export interface CompanionModel {
  analyse(source: string, context: string): Promise<{ purpose: string | null }>;
  propose(
    source: string,
    context: string,
    mode: "language" | "clarity",
  ): Promise<{ revision: string; explanation: string[]; questions: string[] }>;
}

export interface CompanionOptions {
  token?: string;
  dataDir?: string;
  model?: CompanionModel | null;
  modelId?: string;
}

export function createCompanion(options?: CompanionOptions): Server;
