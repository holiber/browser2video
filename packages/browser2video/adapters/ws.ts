/**
 * @description WebSocket adapter — dispatches messages via the procedure router.
 *
 * Incoming messages use the canonical ID as the `type` field:
 *   { type: "session.start", mode: "human", record: true }
 *
 * Responses are sent back as:
 *   { type: "result",   id: "session.start", result: { ... } }
 *   { type: "error",    id: "session.start", message: "..." }
 *   { type: "progress", id: "session.start", current: 1, total: 3, message: "..." }
 *
 * The adapter can coexist with other WS message handlers — messages whose `type`
 * matches a registered procedure are consumed; all others are ignored (returned false).
 */
import { type Router, type CallContext } from "../unapi.ts";
import { type B2vState, createB2vState } from "../procedures.ts";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsSender {
  send(data: string): void;
}

export interface WsAdapterOptions {
  router: Router;
  state?: B2vState;
  /** Log function. */
  log?: (level: "info" | "error", message: string) => void;
}

/**
 * Create a WebSocket message handler function.
 *
 * Returns an async function that accepts a parsed message and a sender.
 * It returns `true` if the message was handled (matched a procedure),
 * `false` if it should be passed to another handler.
 */
export function createWsHandler(opts: WsAdapterOptions): (
  msg: WsMessage,
  ws: WsSender,
) => Promise<boolean> {
  const { router, log = () => {} } = opts;
  const state = opts.state ?? createB2vState();
  const procedureIds = new Set(router.ids());

  return async (msg: WsMessage, ws: WsSender): Promise<boolean> => {
    const procId = msg.type;
    if (!procedureIds.has(procId)) return false;

    const { type: _type, ...input } = msg;
    log("info", `WS → ${procId}`);

    const ctx: Partial<CallContext> = {
      state: state as unknown as Record<string, unknown>,
      sendProgress: (current, total, message) => {
        ws.send(JSON.stringify({ type: "progress", id: procId, current, total, message }));
      },
    };

    try {
      const result = await router.call(procId, input, ctx);
      ws.send(JSON.stringify({ type: "result", id: procId, result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", `WS ${procId} failed: ${message}`);
      ws.send(JSON.stringify({ type: "error", id: procId, message }));
    }

    return true;
  };
}

/**
 * Parse a raw WebSocket message and try to handle it via the router.
 * Returns true if handled, false otherwise.
 */
export function createRawWsHandler(opts: WsAdapterOptions): (
  raw: string | Buffer,
  ws: WsSender,
) => Promise<boolean> {
  const handler = createWsHandler(opts);

  return async (raw, ws) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return false;
    }
    if (!msg || typeof msg.type !== "string") return false;
    return handler(msg, ws);
  };
}
