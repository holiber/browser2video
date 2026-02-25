import { Suspense, useMemo } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, ListTodo, TerminalSquare, Columns3, MessageCircle, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import AppPage from "@/pages/app";
import NotesPage from "@/pages/notes";
import TerminalsPage from "@/pages/terminals";
import KanbanPage from "@/pages/kanban";
import ChatPage from "@/pages/chat";
import CalendarPage from "@/pages/calendar";
import MoviePage from "@/pages/movie";
import WikiPage from "@/pages/wiki";
import SlidesPage from "@/pages/slides";
import IPhoneChrome from "@/components/iphone-chrome";
import PixelChrome from "@/components/pixel-chrome";
import { RepoContext } from "@/lib/use-automerge";
import { createRepo } from "@/lib/use-automerge";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { path: "/notes", label: "Todo", icon: ListTodo, testId: "nav-notes" },
  { path: "/chat", label: "Chat", icon: MessageCircle, testId: "nav-chat" },
  { path: "/calendar", label: "Calendar", icon: CalendarDays, testId: "nav-calendar" },
  { path: "/terminals", label: "Terminals", icon: TerminalSquare, testId: "nav-terminals" },
  { path: "/kanban", label: "Kanban Board", icon: Columns3, testId: "nav-kanban" },
] as const;

function NavMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const location = useLocation();

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <h2 className="mb-2 text-lg font-semibold">Browser2Video</h2>
      <Separator />
      <nav className="mt-2 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.path;
          return (
            <Button
              key={item.path}
              variant={active ? "secondary" : "ghost"}
              className="justify-start gap-2"
              data-testid={item.testId}
              onClick={() => onNavigate(item.path)}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>
    </div>
  );
}

function PlainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function DeviceLayout({ role, children }: { role: string | null; children: React.ReactNode }) {
  if (role === "veronica") return <IPhoneChrome>{children}</IPhoneChrome>;
  if (role === "bob") return <PixelChrome>{children}</PixelChrome>;
  return <PlainLayout>{children}</PlainLayout>;
}

function PageRoutes() {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/" element={<AppPage />} />
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/terminals" element={<TerminalsPage />} />
      <Route path="/kanban" element={<KanbanPage />} />
      <Route path="/movie" element={<MoviePage />} />
      <Route path="/wiki" element={<WikiPage />} />
      <Route path="/slides" element={<SlidesPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const location = useLocation();
  const [params] = useSearchParams();
  const role = params.get("role");

  const wsUrl = useMemo(() => params.get("ws") ?? undefined, [params]);
  const repo = useMemo(() => createRepo({ wsUrl }), [wsUrl]);

  return (
    <RepoContext.Provider value={repo}>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <DeviceLayout role={role}>
              <PageRoutes />
            </DeviceLayout>
          </motion.div>
        </AnimatePresence>
      </Suspense>
    </RepoContext.Provider>
  );
}
