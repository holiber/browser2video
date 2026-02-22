/**
 * @description Terminal server for browser2video.
 * Thin wrapper around jabterm's createTerminalServer() for spawning real PTY
 * terminals accessible via WebSocket.
 */
import { createTerminalServer, type TerminalServer as JabtermServer } from "jabterm/server";

export type TerminalServer = {
  /** Base WebSocket URL (without trailing slash), e.g. ws://127.0.0.1:12345 */
  baseWsUrl: string;
  /** Base HTTP URL (without trailing slash), e.g. http://127.0.0.1:12345 */
  baseHttpUrl: string;
  close: () => Promise<void>;
};

export type GridPaneConfig =
  | { type: "terminal"; cmd?: string; testId: string; title: string; allowAddTab?: boolean }
  | { type: "browser"; url: string; testId: string; title: string };

/**
 * Start a terminal WebSocket server powered by jabterm.
 * Each WebSocket connection spawns a real PTY process.
 */
export async function startTerminalWsServer(port = 0): Promise<TerminalServer> {
  const server: JabtermServer = await createTerminalServer({
    port,
    host: "127.0.0.1",
    cwd: process.cwd(),
  });

  const baseWsUrl = `ws://127.0.0.1:${server.port}`;
  const baseHttpUrl = `http://127.0.0.1:${server.port}`;

  return {
    baseWsUrl,
    baseHttpUrl,
    close: () => server.close(),
  };
}
