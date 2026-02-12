/** @description Root application component with routing and sidebar layout */
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import AppPage from "@/pages/app";

function SidebarContent() {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <h2 className="mb-2 text-lg font-semibold">Browser2Video</h2>
      <Separator />
      <nav className="mt-2 flex flex-1 flex-col gap-1">
        <Button
          variant="ghost"
          className="justify-start gap-2"
          data-testid="nav-dashboard"
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Button>
      </nav>
    </div>
  );
}

function AppLayout() {
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className="hidden w-56 shrink-0 border-r bg-sidebar md:block"
        data-testid="sidebar"
      >
        <SidebarContent />
      </aside>

      {/* Mobile header + sheet sidebar */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="mobile-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold">Browser2Video</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          <AppPage />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Routes location={location}>
          <Route path="/" element={<AppLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}
