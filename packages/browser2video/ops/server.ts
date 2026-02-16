/**
 * @description Server management operations.
 */
import { z } from "zod";
import { defineOp } from "../define-op.ts";
import { ServerConfigSchema, ManagedServerSchema } from "../schemas/server.ts";

export const startServerOp = defineOp({
  name: "server.startServer",
  category: "server",
  summary: "Start a local web server.",
  description:
    "Starts a web server based on the configuration: Vite dev server, Next.js, " +
    "a custom shell command, or a static file server. Returns a `ManagedServer` " +
    "with the base URL and a stop() function.",
  input: ServerConfigSchema.nullable().optional(),
  output: ManagedServerSchema.nullable(),
  examples: [
    {
      title: "Start Vite",
      code: 'const server = await startServer({ type: "vite", root: "apps/demo" });',
    },
    {
      title: "Start custom server",
      code: 'const server = await startServer({ type: "command", cmd: "node server.js", port: 3000 });',
    },
  ],
  tags: ["infrastructure"],
});

export const serverOps = [startServerOp] as const;
