/**
 * @description HTTP adapter — POST /api/call/<procedure.id> endpoint.
 *
 * Intended to be mounted on an existing Node.js HTTP server.
 * JSON request body is the procedure input; response is JSON output.
 *
 * Also serves GET /api/procedures for introspection.
 */
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Router, type CallContext } from "../unapi.ts";
import { type B2vState, createB2vState } from "../procedures.ts";

export interface HttpAdapterOptions {
  router: Router;
  state?: B2vState;
  /** URL prefix (default: "/api"). */
  prefix?: string;
  /** Log function. */
  log?: (level: "info" | "error", message: string) => void;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

/**
 * Create an HTTP request handler that can be mounted on an existing server.
 *
 * Returns a function `(req, res) => Promise<boolean>`:
 * - Returns `true` if the request was handled
 * - Returns `false` if the URL doesn't match (caller should handle normally)
 */
export function createHttpHandler(opts: HttpAdapterOptions): (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean> {
  const { router, log = () => {} } = opts;
  const state = opts.state ?? createB2vState();
  const prefix = opts.prefix ?? "/api";

  const callPrefix = `${prefix}/call/`;
  const proceduresPath = `${prefix}/procedures`;

  return async (req, res): Promise<boolean> => {
    const url = req.url ?? "";

    // CORS preflight
    if (req.method === "OPTIONS" && url.startsWith(prefix)) {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return true;
    }

    // GET /api/procedures — list all registered procedures
    if (req.method === "GET" && url === proceduresPath) {
      const descriptors = router.describe().map((d) => ({
        id: d.id,
        resource: d.resource,
        action: d.action,
        description: d.meta.description,
        tags: d.meta.tags,
        hasHandler: d.hasHandler,
      }));
      sendJson(res, 200, { procedures: descriptors });
      return true;
    }

    // POST /api/call/<procedure.id>
    if (req.method === "POST" && url.startsWith(callPrefix)) {
      const procedureId = decodeURIComponent(url.slice(callPrefix.length));
      if (!router.has(procedureId)) {
        sendJson(res, 404, { error: `Unknown procedure: "${procedureId}"` });
        return true;
      }

      log("info", `HTTP POST ${callPrefix}${procedureId}`);

      let input: unknown;
      try {
        const body = await readBody(req);
        input = body ? JSON.parse(body) : {};
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return true;
      }

      const ctx: Partial<CallContext> = {
        state: state as unknown as Record<string, unknown>,
      };

      try {
        const result = await router.call(procedureId, input, ctx);
        sendJson(res, 200, { id: procedureId, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("error", `HTTP ${procedureId} failed: ${message}`);
        sendJson(res, 500, { id: procedureId, error: message });
      }

      return true;
    }

    return false;
  };
}
