/**
 * @description iPhone / iOS-style device chrome.
 * Wraps page content with a status bar (Dynamic Island), dock, and home indicator.
 */
import { useCallback, type ReactNode } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Phone,
  Globe,
  MessageCircle,
  Camera,
  Music,
  Map,
  Settings,
  Wifi,
  BatteryMedium,
  Signal,
} from "lucide-react";

const DOCK_APPS = [
  { id: "phone", icon: Phone, label: "Phone", color: "from-green-400 to-green-600" },
  { id: "safari", icon: Globe, label: "Safari", color: "from-sky-400 to-blue-600" },
  { id: "messages", icon: MessageCircle, label: "Messages", color: "from-green-400 to-emerald-600", testId: "dock-messages" },
  { id: "camera", icon: Camera, label: "Camera", color: "from-zinc-500 to-zinc-700" },
] as const;

interface Props {
  children: ReactNode;
  onMessengerClick?: () => void;
}

function StatusBar() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="flex items-center justify-between px-5 pt-1 pb-0.5 bg-zinc-950 shrink-0">
      <span className="text-[13px] font-semibold text-white w-14">{time}</span>

      {/* Dynamic Island */}
      <div className="w-24 h-[22px] rounded-full bg-black border border-zinc-800" />

      <div className="flex items-center gap-1 w-14 justify-end">
        <Signal className="h-3 w-3 text-white" />
        <Wifi className="h-3 w-3 text-white" />
        <BatteryMedium className="h-3.5 w-3.5 text-white" />
      </div>
    </div>
  );
}

export default function IPhoneChrome({ children, onMessengerClick }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const role = params.get("role") ?? "veronica";
  const ws = params.get("ws") ?? "";

  const handleDockClick = useCallback(
    (appId: string) => {
      if (appId === "messages") {
        if (onMessengerClick) {
          onMessengerClick();
        } else {
          navigate(`/chat?role=${encodeURIComponent(role)}&ws=${encodeURIComponent(ws)}`);
        }
      }
    },
    [navigate, role, ws, onMessengerClick],
  );

  const isMessengerActive = location.pathname === "/chat";

  return (
    <div className="flex flex-col h-screen bg-zinc-950 overflow-hidden">
      <div className="select-none">
        <StatusBar />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{children}</div>

      {/* Dock */}
      <div className="shrink-0 flex justify-center pb-0.5 pt-1 bg-zinc-950/80 backdrop-blur-xl select-none">
        <div className="flex items-end gap-4 px-5 py-1.5">
          {DOCK_APPS.map((app) => {
            const Icon = app.icon;
            const isActive = app.id === "messages" && isMessengerActive;
            return (
              <button
                key={app.id}
                onClick={() => handleDockClick(app.id)}
                data-testid={app.testId}
                title={app.label}
                className="group relative flex flex-col items-center"
              >
                <div
                  className={`
                    w-12 h-12 rounded-[13px] bg-gradient-to-br ${app.color}
                    flex items-center justify-center
                    transition-transform duration-150 group-hover:scale-105
                    shadow-lg
                  `}
                >
                  <Icon className="h-6 w-6 text-white drop-shadow" />
                </div>
                {isActive && (
                  <div className="w-1 h-1 rounded-full bg-white/70 mt-1" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Home indicator */}
      <div className="flex justify-center pb-1.5 pt-0.5 bg-zinc-950 select-none">
        <div className="w-32 h-1 rounded-full bg-zinc-600" />
      </div>
    </div>
  );
}
