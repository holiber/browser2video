/**
 * @description Laptop scene — renders a laptop frame with a browser slot and
 * a terminal slot that slides down from the top (Quake console style).
 *
 * Slots (in order):
 *   0 = "browser" — main content area, always visible
 *   1 = "terminal" — slides down when toggled (CSS transform)
 *
 * The terminal is always mounted (PTY stays alive); the toggle only controls
 * visibility via CSS transform + transition.
 */
import type { SceneComponentProps } from "./scene-renderer";
import { SlotPane } from "./slot-pane";

export function LaptopScene({
  scene,
  resolvedSlots,
  jabtermWsUrl,
  slotOffset,
  sceneActionStates,
}: SceneComponentProps) {
  const browserSlot = resolvedSlots[slotOffset];
  const terminalSlot = resolvedSlots[slotOffset + 1];

  const actionKey = `${scene.name}/toggleTerminal`;
  const terminalVisible = (sceneActionStates[actionKey] ?? scene.actions?.find((a) => a.id === "toggleTerminal")?.defaultState ?? false) === true;

  return (
    <div
      data-testid="scene-laptop-frame"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a0a",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Laptop bezel top */}
      <div style={{
        height: 8,
        background: "linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%)",
        borderRadius: "8px 8px 0 0",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#555",
        }} />
      </div>

      {/* Screen area */}
      <div style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        border: "2px solid #3a3a3a",
        background: "#1e1e1e",
      }}>
        {/* Terminal overlay — always mounted, slides via transform */}
        {terminalSlot && (
          <div
            data-testid="scene-laptop-terminal"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "40%",
              zIndex: 5,
              transform: terminalVisible ? "translateY(0)" : "translateY(-100%)",
              transition: "transform 0.3s ease",
              borderBottom: terminalVisible ? "2px solid #4a4a4a" : "none",
            }}
          >
            <SlotPane slot={terminalSlot} jabtermWsUrl={jabtermWsUrl} />
          </div>
        )}

        {/* Browser content — main area */}
        {browserSlot && (
          <div
            data-testid="scene-slot-browser"
            style={{ width: "100%", height: "100%" }}
          >
            <SlotPane slot={browserSlot} jabtermWsUrl={jabtermWsUrl} />
          </div>
        )}
      </div>

      {/* Laptop base / hinge */}
      <div style={{
        height: 12,
        background: "linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)",
        borderRadius: "0 0 4px 4px",
        flexShrink: 0,
      }} />
    </div>
  );
}
