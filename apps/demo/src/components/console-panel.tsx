/**
 * @description In-page console panel that faithfully reproduces the Chrome DevTools
 * Console appearance. Intercepts real console.log/warn/error/info calls and
 * renders them with the same styling as Chrome's Console tab.
 * Because it's part of the page DOM, screencast recording captures it.
 */
import { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LogLevel = "log" | "warn" | "error" | "info";

interface LogEntry {
  id: number;
  level: LogLevel;
  args: string;
  timestamp: string;
  /** Source location shown on the right (fake but realistic) */
  source: string;
}

/* ------------------------------------------------------------------ */
/*  Chrome DevTools–like styling per level                              */
/* ------------------------------------------------------------------ */

const levelConfig: Record<LogLevel, {
  icon: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  iconColor: string;
}> = {
  log: {
    icon: "",
    textColor: "#d4d4d4",
    bgColor: "transparent",
    borderColor: "#3c3c3c",
    iconColor: "",
  },
  info: {
    icon: "ℹ",
    textColor: "#d4d4d4",
    bgColor: "transparent",
    borderColor: "#3c3c3c",
    iconColor: "#6b9eff",
  },
  warn: {
    icon: "⚠",
    textColor: "#f5c842",
    bgColor: "rgba(51, 43, 0, 0.4)",
    borderColor: "#665b00",
    iconColor: "#f5c842",
  },
  error: {
    icon: "✖",
    textColor: "#ff6e6e",
    bgColor: "rgba(51, 0, 0, 0.3)",
    borderColor: "#5c0000",
    iconColor: "#ff6e6e",
  },
};

/* Sources rotated for realism */
const fakeSources = [
  "notes.tsx:271",
  "notes.tsx:283",
  "notes.tsx:296",
  "notes.tsx:306",
  "notes.tsx:335",
  "use-automerge.ts:42",
];
let sourceIdx = 0;
function nextSource(): string {
  const s = fakeSources[sourceIdx % fakeSources.length];
  sourceIdx++;
  return s;
}

/* ------------------------------------------------------------------ */
/*  Serialize console arguments                                        */
/* ------------------------------------------------------------------ */

function serializeArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a, null, 2);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

let entryIdCounter = 0;

export function ConsolePanel({
  testId = "console-panel",
  className = "",
  style,
}: {
  testId?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pushEntry = useCallback((level: LogLevel, args: unknown[]) => {
    const now = new Date();
    const ts =
      [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":") +
      "." +
      String(now.getMilliseconds()).padStart(3, "0");

    entryIdCounter += 1;
    setEntries((prev) => [
      ...prev,
      {
        id: entryIdCounter,
        level,
        args: serializeArgs(args),
        timestamp: ts,
        source: nextSource(),
      },
    ]);
  }, []);

  /* Monkey-patch console on mount, restore on unmount */
  useEffect(() => {
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const levels: LogLevel[] = ["log", "info", "warn", "error"];
    for (const level of levels) {
      (console as any)[level] = (...args: unknown[]) => {
        originals[level].apply(console, args as any);
        pushEntry(level, args);
      };
    }

    return () => {
      for (const level of levels) {
        (console as any)[level] = originals[level];
      }
    };
  }, [pushEntry]);

  /* Auto-scroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div
      data-testid={testId}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#242424",
        ...style,
        fontFamily:
          'Menlo, "DejaVu Sans Mono", Consolas, "Lucida Console", monospace',
        fontSize: "11px",
        lineHeight: "16px",
        color: "#d4d4d4",
        overflow: "hidden",
      }}
    >
      {/* DevTools-style toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1px",
          background: "#1e1e1e",
          borderBottom: "1px solid #3c3c3c",
          height: "28px",
          flexShrink: 0,
          padding: "0 8px",
        }}
      >
        {/* Tab bar — Elements, Console, Sources, etc. */}
        {["Elements", "Console", "Sources", "Network"].map((tab) => (
          <div
            key={tab}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              cursor: "default",
              borderBottom:
                tab === "Console" ? "2px solid #6b9eff" : "2px solid transparent",
              color: tab === "Console" ? "#e0e0e0" : "#888",
              fontWeight: tab === "Console" ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            {tab}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: "10px",
            color: "#888",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ color: "#6b9eff" }}>⊘</span>
          <span style={{ opacity: 0.5 }}>Filter</span>
          <span style={{ color: "#666", marginLeft: "4px" }}>Default levels ▾</span>
        </div>
      </div>

      {/* Console entries */}
      <div
        ref={scrollRef}
        data-testid={`${testId}-entries`}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
        }}
      >
        {entries.length === 0 && (
          <div
            style={{
              padding: "8px 20px",
              color: "#666",
              fontStyle: "italic",
            }}
          >
            Console was cleared
          </div>
        )}
        {entries.map((entry) => {
          const cfg = levelConfig[entry.level];
          return (
            <div
              key={entry.id}
              data-testid={`${testId}-entry`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                padding: "2px 8px 2px 20px",
                borderBottom: `1px solid ${cfg.borderColor}`,
                background: cfg.bgColor,
                color: cfg.textColor,
                minHeight: "18px",
                position: "relative",
              }}
            >
              {/* Level icon (positioned like Chrome's gutter) */}
              {cfg.icon && (
                <span
                  style={{
                    position: "absolute",
                    left: "6px",
                    top: "2px",
                    color: cfg.iconColor,
                    fontSize: "10px",
                    width: "12px",
                    textAlign: "center",
                  }}
                >
                  {cfg.icon}
                </span>
              )}

              {/* Message */}
              <span
                style={{
                  flex: 1,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {entry.args}
              </span>

              {/* Source link (right-aligned, like Chrome) */}
              <span
                style={{
                  flexShrink: 0,
                  marginLeft: "12px",
                  color: "#5a8a5a",
                  fontSize: "10px",
                  lineHeight: "16px",
                  textDecoration: "underline",
                  cursor: "default",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.source}
              </span>
            </div>
          );
        })}
      </div>

      {/* Input prompt at bottom (like Chrome's "> " prompt) */}
      <div
        style={{
          borderTop: "1px solid #3c3c3c",
          padding: "3px 8px 3px 20px",
          display: "flex",
          alignItems: "center",
          color: "#6b9eff",
          height: "22px",
          flexShrink: 0,
          background: "#1e1e1e",
        }}
      >
        <span style={{ position: "absolute", left: "14px", fontSize: "10px" }}>
          ›
        </span>
        <span
          style={{
            flex: 1,
            outline: "none",
            color: "#d4d4d4",
            opacity: 0.3,
            fontSize: "11px",
          }}
        >
          &nbsp;
        </span>
      </div>
    </div>
  );
}
