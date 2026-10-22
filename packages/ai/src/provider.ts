import type { ErrorCode } from "@partspilot/shared";

export type ContentPart = { text: string } | { image: { mime: string; data: Uint8Array } };

export interface JsonRequest {
  /** Instructions. Never contains user text; user text goes in `parts` as delimited data. */
  system: string;
  parts: ContentPart[];
  /** JSON Schema used for constrained decoding when the provider supports it. */
  schema?: Record<string, unknown>;
  temperature?: number;
  /** Ask for high image resolution (reading printed part numbers). */
  highResImages?: boolean;
}

/**
 * The only surface the pipeline uses. Deliberately no tool/function calling: the model
 * can return JSON and nothing else.
 */
export interface ModelProvider {
  readonly name: string;
  generateJson(req: JsonRequest): Promise<unknown>;
  embed(texts: string[], task: "query" | "document"): Promise<number[][]>;
}

export class ModelError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryable: boolean,
    readonly detail = "",
  ) {
    super(`${code}${detail ? `:${detail}` : ""}`);
  }
}

export const EMBEDDING_DIMS = 768;
