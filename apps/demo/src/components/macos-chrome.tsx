/**
 * @description macOS-style device chrome with title bar and dock.
 * Wraps page content to look like a native macOS window.
 */
import { useCallback, type ReactNode } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  FolderOpen,
  Globe,
  MessageCircle,
  Image,
  Music,
  FileText,
  Settings,
  Compass,
} from "lucide-react";

const DOCK_APPS = [
  { id: "finder", icon: FolderOpen, label: "Finder", color: "from-sky-400 to-sky-600" },
  { id: "safari", icon: Compass, label: "Safari", color: "from-blue-400 to-indigo-600" },
  { id: "messages", icon: MessageCircle, label: "Messages", color: "from-green-400 to-emerald-600", testId: "dock-messages" },
  { id: "photos", icon: Image, label: "Photos", color: "from-orange-300 via-pink-400 to-violet-500" },
  { id: "music", icon: Music, label: "Music", color: "from-pink-500 to-red-500" },
  { id: "notes", icon: FileText, label: "Notes", color: "from-amber-300 to-yellow-500" },
  { id: "settings", icon: Settings, label: "Settings", color: "from-zinc-400 to-zinc-600" },
] as const;

interface Props {
  children: ReactNode;
  title?: string;
  onMessengerClick?: () => void;
}

export default function MacOSChrome({ children, title, onMessengerClick }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const role = params.get("role") ?? "alice";
  const ws = params.get("ws") ?? "";

  const windowTitle = title ?? deriveTitle(location.pathname);

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
    <div className="flex flex-col h-screen bg-zinc-950 select-none overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900/80 backdrop-blur border-b border-zinc-800 shrink-0">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="ml-2 text-xs font-medium text-zinc-500">{windowTitle}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{children}</div>

      {/* Dock */}
      <div className="shrink-0 flex justify-center pb-1.5 pt-1">
        <div
          className="flex items-end gap-1 px-2.5 py-1.5 rounded-2xl bg-zinc-800/60 backdrop-blur-xl border border-zinc-700/50"
          data-testid="macos-dock"
        >
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
                    w-10 h-10 rounded-xl bg-gradient-to-br ${app.color}
                    flex items-center justify-center
                    transition-transform duration-150 group-hover:scale-110 group-hover:-translate-y-1
                    shadow-md
                  `}
                >
                  <Icon className="h-5 w-5 text-white drop-shadow" />
                </div>
                {isActive && (
                  <div className="w-1 h-1 rounded-full bg-zinc-400 mt-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function deriveTitle(pathname: string): string {
  if (pathname === "/movie") return "Movies & TV";
  if (pathname === "/chat") return "Messages";
  if (pathname === "/calendar") return "Calendar";
  return "Finder";
}
