/**
 * @description Server configuration schemas.
 */
import { z } from "zod";

export const ServerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("vite"),
    root: z.string().describe("Project root directory containing vite.config."),
    port: z.number().int().optional().describe("Preferred port (0 = auto)."),
  }).describe("Start a Vite dev server."),
  z.object({
    type: z.literal("next"),
    root: z.string().describe("Project root directory."),
    port: z.number().int().optional().describe("Preferred port (0 = auto)."),
  }).describe("Start a Next.js dev server."),
  z.object({
    type: z.literal("command"),
    cmd: z.string().describe("Shell command to start the server."),
    port: z.number().int().describe("Port the server will listen on."),
    readyPattern: z.string().optional().describe("Stdout pattern that signals the server is ready."),
  }).describe("Start a custom command-based server."),
  z.object({
    type: z.literal("static"),
    root: z.string().describe("Directory to serve static files from."),
    port: z.number().int().optional().describe("Preferred port (0 = auto)."),
  }).describe("Start a static file server."),
]).describe("Server configuration for scenarios that need a local web server.");

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const ManagedServerSchema = z.object({
  baseURL: z.string().describe("The base URL the server is listening on."),
});

export type ManagedServer = z.infer<typeof ManagedServerSchema> & {
  stop: () => Promise<void>;
};
