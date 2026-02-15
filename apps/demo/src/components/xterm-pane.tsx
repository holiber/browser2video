/**
 * @description Reusable xterm.js terminal pane connected to a WebSocket PTY.
 * Shows a title label and a terminal container that auto-fits to its parent.
 */
import { useRef, useEffect } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

export function XtermPane(props: {
  title: string;
  wsUrl: string;
  testId: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let stopped = false;
    el.dataset.b2vWsState = "connecting";

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      disableStdin: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // Focus-guard: first click on an unfocused terminal focuses it without
    // forwarding a mouse event into the PTY (which would cause TUI apps like
    // htop/mc to interpret the click as a UI action, e.g. pressing "Quit").
    // Once focused, subsequent clicks pass through normally for TUI mouse interaction.
    const focusGuard = (e: MouseEvent) => {
      const textarea = el.querySelector(".xterm-helper-textarea") as HTMLElement;
      if (textarea && document.activeElement !== textarea) {
        e.stopPropagation();
        e.preventDefault();
        textarea.focus();
      }
    };
    el.addEventListener("mousedown", focusGuard, { capture: true });

    termRef.current = term;
    fitRef.current = fit;

    const encoder = new TextEncoder();

    function sendResize() {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }

    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      if (roRaf) cancelAnimationFrame(roRaf);
      roRaf = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // ignore transient layout errors
        }
        sendResize();
      });
    });
    ro.observe(el);

    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
      sendResize();
    });

    const ws = new WebSocket(props.wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (stopped) return;
      el.dataset.b2vWsState = "open";
      sendResize();
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (stopped) return;
      const data: any = (ev as any).data;
      if (typeof data === "string") return;
      if (data instanceof ArrayBuffer) {
        try { term.write(new Uint8Array(data)); } catch { /* ignore after dispose */ }
        return;
      }
      if (typeof Blob !== "undefined" && data instanceof Blob) {
        void data.arrayBuffer().then((ab) => {
          if (stopped) return;
          try { term.write(new Uint8Array(ab)); } catch { /* ignore */ }
        });
      }
    };

    ws.onerror = () => {
      if (stopped) return;
      el.dataset.b2vWsState = "error";
    };

    ws.onclose = (e) => {
      if (stopped) return;
      el.dataset.b2vWsState = `closed:${(e as any)?.code ?? "?"}`;
    };

    const disp = term.onData((data) => {
      if (stopped) return;
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      sock.send(encoder.encode(data));
    });

    return () => {
      stopped = true;
      el.removeEventListener("mousedown", focusGuard, { capture: true });
      disp.dispose();
      ro.disconnect();
      if (roRaf) cancelAnimationFrame(roRaf);
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      try {
        term.dispose();
      } catch {
        // ignore
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [props.wsUrl]);

  return (
    <div className={`flex flex-col ${props.className ?? ""}`}>
      <div className="mb-1 flex items-center justify-between px-1">
        <div className="text-[11px] font-semibold text-muted-foreground">{props.title}</div>
      </div>
      <div
        ref={containerRef}
        data-testid={props.testId}
        className="flex-1 min-h-0 w-full rounded border bg-black/90 p-1"
      />
    </div>
  );
}
