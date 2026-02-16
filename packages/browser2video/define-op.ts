/**
 * @description defineOp() — the building block for the operation registry.
 * Each operation carries runtime metadata (name, docs, Zod schemas)
 * that CLI, MCP, and the doc generator all consume.
 */
import { type ZodType } from "zod";

export interface OpExample {
  title: string;
  code: string;
}

export interface OpDef<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /** Dot-namespaced identifier, e.g. "actor.click" or "tool.run". */
  name: string;
  /** Grouping category for docs sidebar and registry filtering. */
  category: "session" | "actor" | "narration" | "server" | "tool";
  /** One-line summary (appears in CLI help, MCP tool description, docs heading). */
  summary: string;
  /** Extended description (Markdown-safe). */
  description: string;
  /** Zod schema for the operation's input. */
  input: I;
  /** Zod schema for the operation's output. */
  output: O;
  /** Code examples shown in docs and SKILL.md. */
  examples?: OpExample[];
  /** Free-form tags for search / filtering. */
  tags?: string[];
  /** When true, this operation is exposed as an MCP tool. */
  mcp?: boolean;
  /** When true, this operation is exposed as a CLI command. */
  cli?: boolean;
}

/**
 * Define a Browser2Video operation.
 * The returned object IS the definition — no wrapper class needed.
 */
export function defineOp<I extends ZodType, O extends ZodType>(
  def: OpDef<I, O>,
): OpDef<I, O> {
  return def;
}
