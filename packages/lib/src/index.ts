/**
 * @description Public API for @browser2video/lib.
 * Single source of truth for schemas, operations, and the registry.
 */

// Define-op helper
export { defineOp, type OpDef, type OpExample } from "./define-op.ts";

// Registry
export { ops, mcpTools, cliCommands, getOp, getOpsByCategory } from "./registry.ts";

// Schemas — common
export {
  ModeSchema, type Mode,
  RecordModeSchema, type RecordMode,
  DelayRangeSchema, type DelayRange,
  ActorDelaysSchema, type ActorDelays,
  LayoutConfigSchema, type LayoutConfig,
  ViewportSchema, type Viewport,
} from "./schemas/common.ts";

// Schemas — session
export {
  SessionOptionsSchema, type SessionOptions,
  PageOptionsSchema, type PageOptions,
  TerminalOptionsSchema, type TerminalOptions,
  StepRecordSchema, type StepRecord,
  SessionResultSchema, type SessionResult,
} from "./schemas/session.ts";

// Schemas — narration
export {
  NarrationOptionsSchema, type NarrationOptions,
  SpeakOptionsSchema, type SpeakOptions,
  EffectOptionsSchema, type EffectOptions,
  AudioEventSchema, type AudioEvent,
} from "./schemas/narration.ts";

// Schemas — server
export {
  ServerConfigSchema, type ServerConfig,
  ManagedServerSchema, type ManagedServer,
} from "./schemas/server.ts";

// Tool-level schemas (used by CLI and MCP)
export {
  RunInputSchema, type RunInput,
  RunOutputSchema, type RunOutput,
  runTool, listTool, doctorTool,
} from "./ops/tools.ts";

// Ops by category (for advanced usage)
export { sessionOps } from "./ops/session.ts";
export { actorOps } from "./ops/actor.ts";
export { narrationOps } from "./ops/narration.ts";
export { serverOps } from "./ops/server.ts";
export { toolOps } from "./ops/tools.ts";
