/**
 * @description Google Pixel / Android-style device chrome.
 * Wraps page content with a status bar and 3-button navigation bar.
 */
import { type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Wifi, BatteryMedium, Signal } from "lucide-react";

interface Props {
  children: ReactNode;
}

function StatusBar() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div
      className="flex items-center justify-between px-4 py-1 bg-zinc-900 shrink-0"
      data-testid="pixel-status-bar"
    >
      <span className="text-[11px] font-medium text-zinc-300">{time}</span>
      <div className="flex items-center gap-1.5">
        <Signal className="h-3 w-3 text-zinc-400" />
        <Wifi className="h-3 w-3 text-zinc-400" />
        <BatteryMedium className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-[10px] text-zinc-500 ml-0.5">82%</span>
      </div>
    </div>
  );
}

function NavBar() {
  return (
    <div
      className="flex items-center justify-center gap-10 py-2 bg-zinc-900 shrink-0"
      data-testid="pixel-nav-bar"
    >
      {/* Back */}
      <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[8px] border-r-zinc-500" />
      {/* Home */}
      <div className="w-4 h-4 rounded-full border-2 border-zinc-500" />
      {/* Recents */}
      <div className="w-3.5 h-3.5 rounded-sm border-2 border-zinc-500" />
    </div>
  );
}

export default function PixelChrome({ children }: Props) {
  const location = useLocation();
  const pageTitle = deriveTitle(location.pathname);

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none overflow-hidden">
      <StatusBar />

      {/* App bar */}
      <div className="flex items-center px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/50 shrink-0">
        <span className="text-sm font-medium text-zinc-300">{pageTitle}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{children}</div>

      {/* Gesture pill + nav */}
      <NavBar />
    </div>
  );
}

function deriveTitle(pathname: string): string {
  if (pathname === "/chat") return "Messages";
  if (pathname === "/calendar") return "Calendar";
  if (pathname === "/wiki") return "Chrome";
  if (pathname === "/") return "Home";
  return "App";
}
