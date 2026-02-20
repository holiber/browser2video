import { useRef, useEffect, useState } from "react";
import type { CursorState } from "../hooks/use-player";

interface CursorOverlayProps {
  cursor: CursorState;
  viewportWidth: number;
  viewportHeight: number;
}

export function CursorOverlay({ cursor, viewportWidth, viewportHeight }: CursorOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ w: width, h: height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    return () => ro.disconnect();
  }, []);

  if (!cursor.visible || !viewportWidth || !viewportHeight) {
    return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />;
  }

  const scaleX = size.w / viewportWidth;
  const scaleY = size.h / viewportHeight;
  const displayX = cursor.x * scaleX;
  const displayY = cursor.y * scaleY;

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
      <div
        className="absolute"
        style={{
          transform: `translate(${displayX - 2}px, ${displayY - 2}px)`,
          transition: "transform 16ms linear",
          willChange: "transform",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M3 2L3 17L7.5 12.5L11.5 18L14 16.5L10 11L16 11L3 2Z"
            fill="white"
            stroke="black"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {cursor.clickEffect && (
        <div
          key={`${displayX}-${displayY}-${Date.now()}`}
          className="absolute animate-ripple"
          style={{
            left: displayX,
            top: displayY,
            border: "3px solid rgba(96, 165, 250, 0.9)",
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
