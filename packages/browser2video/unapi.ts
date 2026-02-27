/**
 * @description Unapi — unified procedure registry for browser2video.
 *
 * A procedure is the atomic unit: canonical ID, Zod schemas, handler, and metadata.
 * All surfaces (CLI, MCP, WebSocket, HTTP) are derived from the same definitions.
 *
 * @see https://raw.githubusercontent.com/holiber/unikanban/refs/heads/main/docs/unapi.md
 */
import { type ZodType, type z, type ZodObject, type ZodRawShape } from "zod";

export interface ProcedureMeta {
  description: string;
  tags?: string[];
  examples?: Array<{ title: string; code: string }>;
}

export interface Procedure<
  I extends ZodType = ZodType,
  O extends ZodType = ZodType,
> {
  id: string;
  meta: ProcedureMeta;
  input: I;
  output: O;
  handler?: (input: z.infer<I>, ctx: CallContext) => Promise<z.infer<O>>;
}

export interface CallContext {
  /** Opaque state bag that transports attach (e.g. WebSocket reference, session). */
  state: Record<string, unknown>;
  /** Send a progress notification to the caller (MCP / WS). */
  sendProgress?: (current: number, total: number, message: string) => void;
}

export function defineProcedure<I extends ZodType, O extends ZodType>(
  def: Procedure<I, O>,
): Procedure<I, O> {
  return def;
}

export interface ProcedureDescriptor {
  id: string;
  resource: string;
  action: string;
  meta: ProcedureMeta;
  inputSchema: ZodType;
  outputSchema: ZodType;
  hasHandler: boolean;
}

export class Router {
  private _procedures = new Map<string, Procedure>();

  register(proc: Procedure): this {
    if (this._procedures.has(proc.id)) {
      throw new Error(`Procedure "${proc.id}" is already registered.`);
    }
    this._procedures.set(proc.id, proc);
    return this;
  }

  registerAll(procs: Procedure[]): this {
    for (const p of procs) this.register(p);
    return this;
  }

  get(id: string): Procedure | undefined {
    return this._procedures.get(id);
  }

  has(id: string): boolean {
    return this._procedures.has(id);
  }

  ids(): string[] {
    return [...this._procedures.keys()];
  }

  /** Call a procedure: validate input, run handler, validate output. */
  async call<I extends ZodType, O extends ZodType>(
    id: string,
    rawInput: unknown,
    ctx?: Partial<CallContext>,
  ): Promise<z.infer<O>> {
    const proc = this._procedures.get(id);
    if (!proc) throw new Error(`Unknown procedure: "${id}"`);
    if (!proc.handler) throw new Error(`Procedure "${id}" has no handler.`);

    const parsed = proc.input.parse(rawInput);
    const fullCtx: CallContext = {
      state: ctx?.state ?? {},
      sendProgress: ctx?.sendProgress,
    };

    const result = await proc.handler(parsed, fullCtx);
    return proc.output.parse(result);
  }

  /** Return metadata for all registered procedures (for tooling). */
  describe(): ProcedureDescriptor[] {
    return [...this._procedures.values()].map((p) => {
      const [resource, ...rest] = p.id.split(".");
      return {
        id: p.id,
        resource: resource ?? p.id,
        action: rest.join(".") || p.id,
        meta: p.meta,
        inputSchema: p.input,
        outputSchema: p.output,
        hasHandler: !!p.handler,
      };
    });
  }

  /** Get all unique resource names (first segment of each ID). */
  resources(): string[] {
    const set = new Set<string>();
    for (const id of this._procedures.keys()) {
      set.add(id.split(".")[0]!);
    }
    return [...set];
  }

  /** Get procedures grouped by resource. */
  byResource(): Map<string, ProcedureDescriptor[]> {
    const groups = new Map<string, ProcedureDescriptor[]>();
    for (const desc of this.describe()) {
      const list = groups.get(desc.resource) ?? [];
      list.push(desc);
      groups.set(desc.resource, list);
    }
    return groups;
  }
}

/**
 * Create a typed caller client from a router.
 * The client nests methods by splitting procedure IDs on dots.
 *
 * ```ts
 * const client = createClient(router, ctx);
 * await client.session.start({ mode: "human" });
 * await client.actor.click({ selector: "button" });
 * ```
 */
export function createClient(
  router: Router,
  ctx?: Partial<CallContext>,
): Record<string, Record<string, (input?: unknown) => Promise<unknown>>> {
  const client: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
  for (const id of router.ids()) {
    const [resource, ...rest] = id.split(".");
    const action = rest.join(".");
    if (!resource || !action) continue;
    if (!client[resource]) client[resource] = {};
    client[resource][action] = (input?: unknown) => router.call(id, input, ctx);
  }
  return client;
}
