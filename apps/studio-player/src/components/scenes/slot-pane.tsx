/**
 * @description Shared pane renderers for scene slots — terminal and browser.
 * Reuses the same JabTerm / iframe pattern as ScenarioGrid but as standalone
 * components that can be placed inside any scene layout.
 */
import { useEffect, useRef } from "react";
import { JabTerm } from "jabterm/react";
import "@xterm/xterm/css/xterm.css";
import type { ResolvedSlot } from "browser2video";

function buildWsUrl(baseWsUrl: string, slot: ResolvedSlot): string {
  const terminalId = slot.cmd ? `cmd:${slot.cmd}` : (slot.testId ?? "shell");
  return `${baseWsUrl}/${encodeURIComponent(terminalId)}`;
}

export function TerminalSlotPane({ slot, jabtermWsUrl }: { slot: ResolvedSlot; jabtermWsUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsUrl = buildWsUrl(jabtermWsUrl, slot);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => window.dispatchEvent(new Event("resize")), 150);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid={slot.testId}
      className="w-full h-full"
      style={{ background: "#1e1e1e" }}
    >
      <JabTerm
        wsUrl={wsUrl}
        fontSize={13}
        theme={{ background: "#1e1e1e" }}
        accessibilitySupport="on"
      />
    </div>
  );
}

export function BrowserSlotPane({ slot }: { slot: ResolvedSlot }) {
  return (
    <div data-testid={slot.testId} className="w-full h-full">
      <iframe
        name={slot.testId}
        src={slot.url}
        className="w-full h-full border-none"
        title={slot.title}
      />
    </div>
  );
}

export function SlotPane({ slot, jabtermWsUrl }: { slot: ResolvedSlot; jabtermWsUrl: string }) {
  if (slot.type === "browser" && slot.url) {
    return <BrowserSlotPane slot={slot} />;
  }
  if (slot.type === "terminal") {
    return <TerminalSlotPane slot={slot} jabtermWsUrl={jabtermWsUrl} />;
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm bg-zinc-900">
      Loading...
    </div>
  );
}
