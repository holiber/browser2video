/**
 * @description MCP adapter — derives MCP tools from the procedure router.
 *
 * Each procedure `resource.action` becomes MCP tool `b2v_resource_action`.
 * Input schemas are forwarded as-is (Zod schemas, compatible with MCP SDK).
 */
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Router, type CallContext, type ProcedureDescriptor } from "../unapi.ts";
import { type B2vState, createB2vState } from "../procedures.ts";
import { type ZodType } from "zod";

/** Convert a canonical procedure ID to an MCP tool name: "session.start" → "b2v_session_start". */
export function procedureIdToMcpName(id: string): string {
  return `b2v_${id.replace(/\./g, "_")}`;
}

/** Convert an MCP tool name back to procedure ID: "b2v_session_start" → "session.start". */
export function mcpNameToProcedureId(name: string): string | null {
  if (!name.startsWith("b2v_")) return null;
  const rest = name.slice(4);
  const parts = rest.split("_");
  if (parts.length < 2) return rest;
  return `${parts[0]}.${parts.slice(1).join("_")}`;
}

function getZodShape(schema: ZodType): Record<string, ZodType> | null {
  const def = (schema as any)?._def;
  if (!def) return null;
  if (def.typeName === "ZodObject") return def.shape?.() ?? null;
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
    return getZodShape(def.innerType);
  }
  return null;
}

export interface McpAdapterOptions {
  /** Pre-existing MCP server instance to register tools on. */
  server: McpServer;
  router: Router;
  state?: B2vState;
  /** Filter which procedures to expose. Default: all with handlers. */
  filter?: (desc: ProcedureDescriptor) => boolean;
  /** Prefix for tool names (default: "b2v"). */
  prefix?: string;
  /** Log function (default: console.error). */
  log?: (level: "info" | "warning" | "error", message: string) => void;
}

/**
 * Register all procedures from the router as MCP tools on the given server.
 * Returns the number of tools registered.
 */
export function registerMcpTools(opts: McpAdapterOptions): number {
  const {
    server,
    router,
    filter = (d) => d.hasHandler,
    prefix = "b2v",
    log = (level, msg) => console.error(`[${prefix}] ${msg}`),
  } = opts;

  const state = opts.state ?? createB2vState();
  const descriptors = router.describe().filter(filter);
  let count = 0;

  for (const desc of descriptors) {
    const toolName = `${prefix}_${desc.id.replace(/\./g, "_")}`;
    const inputShape = getZodShape(desc.inputSchema) ?? {};

    server.registerTool(
      toolName,
      {
        title: desc.meta.description.split(".")[0],
        description: desc.meta.description,
        inputSchema: inputShape,
      },
      async (input: Record<string, unknown>, extra: any) => {
        log("info", `${toolName} ${JSON.stringify(input)}`);

        const ctx: Partial<CallContext> = {
          state: state as unknown as Record<string, unknown>,
          sendProgress: (cur, total, msg) => {
            const token = extra?._meta?.progressToken;
            if (!token) return;
            extra.sendNotification?.({
              method: "notifications/progress",
              params: { progressToken: token, progress: cur, total, message: msg },
            }).catch(() => {});
          },
        };

        try {
          const result = await router.call(desc.id, input, ctx);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(result),
            }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log("error", `${toolName} failed: ${message}`);
          throw err;
        }
      },
    );
    count++;
  }

  return count;
}
