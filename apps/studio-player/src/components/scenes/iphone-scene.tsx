/**
 * @description iPhone scene — renders an iPhone device frame with a single
 * "screen" slot where a browser iframe is displayed. Uses the SVG frame asset
 * from the demo app.
 */
import type { SceneComponentProps } from "./scene-renderer";
import { SlotPane } from "./slot-pane";

const FRAME_CONFIG = {
  viewBox: { w: 410, h: 870 },
  screen: { x: 19, y: 19, w: 372, h: 832, rx: 42 },
};

export function IPhoneScene({
  scene,
  resolvedSlots,
  jabtermWsUrl,
  slotOffset,
}: SceneComponentProps) {
  const slot = resolvedSlots[slotOffset];
  if (!slot) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-500">
        No slot configured for iPhone scene
      </div>
    );
  }

  const { viewBox, screen } = FRAME_CONFIG;
  const pctLeft = `${(screen.x / viewBox.w) * 100}%`;
  const pctTop = `${(screen.y / viewBox.h) * 100}%`;
  const pctWidth = `${(screen.w / viewBox.w) * 100}%`;
  const pctHeight = `${(screen.h / viewBox.h) * 100}%`;
  const pctRadius = `${(screen.rx / screen.w) * 100}%`;

  return (
    <div
      data-testid="scene-iphone-frame"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: `${viewBox.w} / ${viewBox.h}`,
          height: "100%",
          maxWidth: "100%",
        }}
      >
        <div
          data-testid="scene-slot-screen"
          style={{
            position: "absolute",
            left: pctLeft,
            top: pctTop,
            width: pctWidth,
            height: pctHeight,
            borderRadius: pctRadius,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SlotPane slot={slot} jabtermWsUrl={jabtermWsUrl} />
        </div>

        <img
          src="/device-frames/iphone-frame.svg"
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 10,
            userSelect: "none",
          }}
        />
      </div>
    </div>
  );
}
