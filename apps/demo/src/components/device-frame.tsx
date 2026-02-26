/**
 * Generic SVG-based device frame wrapper.
 * Renders children inside the "screen area" of a device outline (iPhone, Pixel, etc.).
 * The SVG frame sits on top with pointer-events disabled so clicks pass through to content.
 */
import { type ReactNode } from "react";

export interface DeviceFrameConfig {
  /** URL to the SVG frame asset (served from /public) */
  frameSrc: string;
  /** SVG viewBox dimensions */
  viewBox: { w: number; h: number };
  /** Screen area coordinates within the viewBox */
  screen: { x: number; y: number; w: number; h: number; rx: number };
}

export const DEVICE_FRAMES: Record<string, DeviceFrameConfig> = {
  iphone: {
    frameSrc: "/device-frames/iphone-frame.svg",
    viewBox: { w: 410, h: 870 },
    screen: { x: 19, y: 19, w: 372, h: 832, rx: 42 },
  },
  pixel: {
    frameSrc: "/device-frames/pixel-frame.svg",
    viewBox: { w: 410, h: 860 },
    screen: { x: 19, y: 19, w: 372, h: 822, rx: 38 },
  },
};

interface Props {
  variant: keyof typeof DEVICE_FRAMES | (string & {});
  children: ReactNode;
  /** Background color behind the device. Defaults to near-black. */
  bg?: string;
}

export default function DeviceFrame({ variant, children, bg = "#0a0a0a" }: Props) {
  const config = DEVICE_FRAMES[variant];
  if (!config) return <>{children}</>;

  const { viewBox, screen } = config;
  const pctLeft = `${(screen.x / viewBox.w) * 100}%`;
  const pctTop = `${(screen.y / viewBox.h) * 100}%`;
  const pctWidth = `${(screen.w / viewBox.w) * 100}%`;
  const pctHeight = `${(screen.h / viewBox.h) * 100}%`;
  const pctRadius = `${(screen.rx / screen.w) * 100}%`;

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
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
        {/* Screen content area */}
        <div
          data-testid="device-screen"
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
          {children}
        </div>

        {/* SVG frame overlay — purely visual, non-interactive */}
        <img
          src={config.frameSrc}
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
