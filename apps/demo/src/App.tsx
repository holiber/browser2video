/** @description Root application component with burger-menu navigation and 6-page routing */
import { Suspense, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, LayoutDashboard, ListTodo, TerminalSquare, Columns3, MessageCircle, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import AppPage from "@/pages/app";
import NotesPage from "@/pages/notes";
import TerminalsPage from "@/pages/terminals";
import KanbanPage from "@/pages/kanban";
import ChatPage from "@/pages/chat";
import CalendarPage from "@/pages/calendar";
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

function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleNavigate = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Hidden burger menu — accessible but not taking header space */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-56 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <NavMenu onNavigate={handleNavigate} />
        </SheetContent>
      </Sheet>

      {/* Page content — full height */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const wsUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("ws") ?? undefined;
  }, [location.search]);

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
            <AppLayout>
              <Routes location={location}>
                <Route path="/" element={<AppPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/terminals" element={<TerminalsPage />} />
                <Route path="/kanban" element={<KanbanPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppLayout>
          </motion.div>
        </AnimatePresence>
      </Suspense>
    </RepoContext.Provider>
  );
}
