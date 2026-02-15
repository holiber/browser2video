/**
 * @description Terminals page with a 2x2 grid of xterm.js panes connected to real PTYs.
 * Top-left: mc, Top-right: htop (or top), Bottom-left: opencode, Bottom-right: shell.
 * Requires ?termWs=<wsBaseUrl> query param to connect to the terminal WS server.
 */
import { XtermPane } from "@/components/xterm-pane";

/** Default port used by the standalone terminal server in dev mode */
const DEV_TERM_PORT = 9800;

function getTermWsFromURL(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get("termWs") ?? "").trim();
  if (raw) return raw.replace(/\/$/, "");
  // In dev mode, fall back to the well-known dev terminal server port
  if (import.meta.env.DEV) return `ws://127.0.0.1:${DEV_TERM_PORT}`;
  return null;
}

export default function TerminalsPage() {
  const termWs = getTermWsFromURL();

  if (!termWs) {
    return (
      <div
        className="flex min-h-[calc(100vh-3rem)] items-center justify-center text-muted-foreground"
        data-testid="terminals-page"
      >
        <p className="text-sm">
          No terminal server configured. Pass <code className="rounded bg-muted px-1.5 py-0.5 text-xs">?termWs=ws://...</code> to connect.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid h-[calc(100vh-3rem)] grid-cols-[1fr_1fr] grid-rows-2 gap-1 p-1"
      data-testid="terminals-page"
    >
      {/* Left column: mc (top) + htop (bottom) */}
      <XtermPane
        title="Midnight Commander"
        wsUrl={`${termWs}/term/mc`}
        testId="xterm-term1"
        className="min-h-0"
      />
      <XtermPane
        title="htop"
        wsUrl={`${termWs}/term/htop`}
        testId="xterm-term2"
        className="min-h-0"
      />

      {/* Right column: shell spanning both rows */}
      <XtermPane
        title="Shell"
        wsUrl={`${termWs}/term/shell`}
        testId="xterm-term4"
        className="min-h-0 row-span-2 col-start-2 row-start-1"
      />
    </div>
  );
}
