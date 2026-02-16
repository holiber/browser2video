/**
 * @description Central operation registry.
 * All ops in one array, plus filtered subsets for MCP and CLI.
 */
import type { OpDef } from "./define-op.ts";
import { sessionOps } from "./ops/session.ts";
import { actorOps } from "./ops/actor.ts";
import { narrationOps } from "./ops/narration.ts";
import { serverOps } from "./ops/server.ts";
import { toolOps } from "./ops/tools.ts";

/** Every registered operation, ordered by category. */
export const ops: readonly OpDef[] = [
  ...sessionOps,
  ...actorOps,
  ...narrationOps,
  ...serverOps,
  ...toolOps,
];

/** Operations that should be exposed as MCP tools. */
export const mcpTools = ops.filter((op) => op.mcp);

/** Operations that should be exposed as CLI commands. */
export const cliCommands = ops.filter((op) => op.cli);

/** Look up an operation by name. */
export function getOp(name: string): OpDef | undefined {
  return ops.find((op) => op.name === name);
}

/** Get all operations in a specific category. */
export function getOpsByCategory(category: OpDef["category"]): readonly OpDef[] {
  return ops.filter((op) => op.category === category);
}
