/**
 * @description Collaborative todo-list page synced between tabs via Automerge Repo.
 * Uses @automerge/react with BroadcastChannel for real-time cross-tab sync.
 * The document is shared via the URL hash (#automerge:...).
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { motion, Reorder, AnimatePresence } from "framer-motion";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import {
  GripVertical,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Wifi,
  WifiOff,
  Crown,
  Wrench,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Motion-enhanced shadcn Button for whileTap animations */
const MotionButton = motion.create(Button);
import {
  useDocument,
  useRepo,
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@/lib/use-automerge";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Task {
  id: string;
  title: string;
  completed: boolean;
  approved?: boolean;
}

interface NotesDoc {
  tasks: Task[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getTermWsFromURL(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get("termWs") ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function getRoleFromURL(): "boss" | "worker" | null {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role");
  if (role === "boss" || role === "worker") return role;
  return null;
}

let taskCounter = 0;

function nextTaskId(): string {
  taskCounter += 1;
  return `task-${taskCounter}`;
}

/* ------------------------------------------------------------------ */
/*  Hook: find or create the shared Automerge document via URL hash    */
/* ------------------------------------------------------------------ */

function useNotesDoc(): AutomergeUrl | null {
  const repo = useRepo();
  const [docUrl, setDocUrl] = useState<AutomergeUrl | null>(null);

  useEffect(() => {
    const hash = document.location.hash.substring(1);

    if (isValidAutomergeUrl(hash)) {
      // Another tab already created the doc — join it
      repo.find<NotesDoc>(hash as AutomergeUrl);
      setDocUrl(hash as AutomergeUrl);
    } else {
      // First tab: create a fresh document
      const handle = repo.create<NotesDoc>({ tasks: [] });
      document.location.hash = handle.url;
      setDocUrl(handle.url);
    }
  }, [repo]);

  return docUrl;
}

/* ------------------------------------------------------------------ */
/*  Task item component                                                */
/* ------------------------------------------------------------------ */

function TaskItem({
  task,
  index,
  onToggle,
  onDelete,
  onRename,
}: {
  task: Task;
  index: number;
  onToggle: (index: number) => void;
  onDelete: (index: number) => void;
  onRename: (index: number, title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.title) {
      onRename(index, trimmed);
    }
    setEditing(false);
  }, [editValue, index, task.title, onRename]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") {
        setEditValue(task.title);
        setEditing(false);
      }
    },
    [commitEdit, task.title],
  );

  return (
    <Reorder.Item
      value={task}
      className="flex items-center gap-2 rounded-lg border bg-card p-2 select-none transition-colors duration-100 hover:bg-muted/30 hover:border-muted-foreground/20 active:bg-muted/50 active:cursor-grabbing"
      data-testid={`note-item-${index}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      }}
    >
      {/* Drag handle */}
      <div
        className="cursor-grab text-muted-foreground"
        data-testid={`note-drag-${index}`}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Checkbox */}
      <motion.button
        className="shrink-0"
        onClick={() => onToggle(index)}
        data-testid={`note-check-${index}`}
        aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
        whileTap={{ scale: 0.75 }}
        transition={{ type: "spring", duration: 0.2, bounce: 0.5 }}
      >
        {task.completed ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" />
        )}
      </motion.button>

      {/* Title (view / edit) */}
      {editing ? (
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="h-8 flex-1"
          data-testid={`note-edit-${index}`}
        />
      ) : (
        <span
          className="relative flex-1 text-sm leading-5"
          onDoubleClick={() => {
            setEditValue(task.title);
            setEditing(true);
          }}
          data-testid={`note-title-${index}`}
        >
          <div className="flex items-center gap-2">
            <span className={task.completed ? "text-muted-foreground" : ""}>
              {task.title}
            </span>
            {task.approved && (
              <span
                className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
                data-testid={`note-approved-${index}`}
              >
                Approved
              </span>
            )}
          </div>
          <AnimatePresence>
            {task.completed && (
              <motion.span
                className="absolute left-0 top-1/2 h-px w-full bg-muted-foreground origin-left"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                exit={{ scaleX: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>
        </span>
      )}

      {/* Delete */}
      <MotionButton
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(index)}
        data-testid={`note-delete-${index}`}
        whileTap={{ scale: 0.8 }}
        transition={{ type: "spring", duration: 0.2, bounce: 0.5 }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </MotionButton>
    </Reorder.Item>
  );
}

/* ------------------------------------------------------------------ */
/*  Xterm.js pane                                                      */
/* ------------------------------------------------------------------ */

function XtermPane(props: {
  title: string;
  wsUrl: string;
  testId: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let stopped = false;
    el.dataset.b2vWsState = "connecting";

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      disableStdin: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // Focus-guard: first click on an unfocused terminal focuses it without
    // forwarding a mouse event into the PTY (which would cause TUI apps like
    // htop/mc to interpret the click as a UI action, e.g. pressing "Quit").
    // Once focused, subsequent clicks pass through normally for TUI mouse interaction.
    const focusGuard = (e: MouseEvent) => {
      const textarea = el.querySelector(".xterm-helper-textarea") as HTMLElement;
      if (textarea && document.activeElement !== textarea) {
        e.stopPropagation();
        e.preventDefault();
        textarea.focus();
      }
    };
    el.addEventListener("mousedown", focusGuard, { capture: true });

    termRef.current = term;
    fitRef.current = fit;

    const encoder = new TextEncoder();

    function sendResize() {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }

    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      if (roRaf) cancelAnimationFrame(roRaf);
      roRaf = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // ignore transient layout errors
        }
        sendResize();
      });
    });
    ro.observe(el);

    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
      sendResize();
    });

    const ws = new WebSocket(props.wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (stopped) return;
      el.dataset.b2vWsState = "open";
      sendResize();
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (stopped) return;
      const data: any = (ev as any).data;
      if (typeof data === "string") return;
      if (data instanceof ArrayBuffer) {
        try { term.write(new Uint8Array(data)); } catch { /* ignore after dispose */ }
        return;
      }
      if (typeof Blob !== "undefined" && data instanceof Blob) {
        void data.arrayBuffer().then((ab) => {
          if (stopped) return;
          try { term.write(new Uint8Array(ab)); } catch { /* ignore */ }
        });
      }
    };

    ws.onerror = () => {
      if (stopped) return;
      el.dataset.b2vWsState = "error";
    };

    ws.onclose = (e) => {
      if (stopped) return;
      el.dataset.b2vWsState = `closed:${(e as any)?.code ?? "?"}`;
    };

    const disp = term.onData((data) => {
      if (stopped) return;
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      sock.send(encoder.encode(data));
    });

    return () => {
      stopped = true;
      el.removeEventListener("mousedown", focusGuard, { capture: true });
      disp.dispose();
      ro.disconnect();
      if (roRaf) cancelAnimationFrame(roRaf);
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      try {
        term.dispose();
      } catch {
        // ignore
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [props.wsUrl]);

  return (
    <div className={props.className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">{props.title}</div>
      </div>
      <div
        ref={containerRef}
        data-testid={props.testId}
        className="h-full w-full rounded-md border bg-black/90 p-2"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notes list (needs a docUrl to use useDocument)                     */
/* ------------------------------------------------------------------ */

function NotesList({ docUrl }: { docUrl: AutomergeUrl }) {
  const role = getRoleFromURL();
  const termWs = getTermWsFromURL();
  const [doc, changeDoc] = useDocument<NotesDoc>(docUrl, { suspense: true });
  const [inputValue, setInputValue] = useState("");

  // ---- Actions ----

  const addTask = useCallback(() => {
    const title = inputValue.trim();
    if (!title) return;
    changeDoc((d) => {
      // Insert newest tasks at the top of the list
      d.tasks.unshift({ id: nextTaskId(), title, completed: false, approved: false });
    });
    setInputValue("");
  }, [inputValue, changeDoc]);

  const toggleTask = useCallback(
    (index: number) => {
      changeDoc((d) => {
        d.tasks[index].completed = !d.tasks[index].completed;
      });
    },
    [changeDoc],
  );

  const deleteTask = useCallback(
    (index: number) => {
      changeDoc((d) => {
        d.tasks.splice(index, 1);
      });
    },
    [changeDoc],
  );

  const renameTask = useCallback(
    (index: number, title: string) => {
      changeDoc((d) => {
        d.tasks[index].title = title;
      });
    },
    [changeDoc],
  );

  const handleReorder = useCallback(
    (newOrder: Task[]) => {
      changeDoc((d) => {
        const ids = newOrder.map((t) => t.id);
        const currentIds = d.tasks.map((t) => t.id);
        if (ids.join(",") === currentIds.join(",")) return;
        // Rebuild the array in the new order
        const taskMap = new Map<string, Task>();
        for (const t of d.tasks) {
          taskMap.set(t.id, {
            id: t.id,
            title: t.title,
            completed: t.completed,
            approved: (t as any).approved,
          });
        }
        d.tasks.splice(0, d.tasks.length);
        for (const id of ids) {
          const t = taskMap.get(id);
          if (t) d.tasks.push(t);
        }
      });
    },
    [changeDoc],
  );

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") addTask();
    },
    [addTask],
  );

  // Build a mutable copy for Reorder (Automerge docs are readonly)
  const tasks: Task[] = doc?.tasks ? [...doc.tasks].map((t) => ({ ...t })) : [];

  const webApp = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Implement notes app</h1>
          {role && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                role === "boss"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-blue-500/15 text-blue-400"
              }`}
              data-testid="role-badge"
            >
              {role === "boss" ? <Crown className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
              {role === "boss" ? "Boss" : "Worker"}
            </span>
          )}
        </div>

        {/* Sync indicator */}
        <div
          className="inline-flex items-center gap-1.5 text-xs text-green-500"
          data-testid="sync-indicator"
        >
          <Wifi className="h-3.5 w-3.5" />
          Synced
        </div>
      </div>

      {/* Add task input */}
      <Card>
        <CardContent className="flex gap-2 pt-4">
          <Input
            placeholder="Add a new task…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            data-testid="note-input"
          />
          <MotionButton
            onClick={addTask}
            data-testid="note-add-btn"
            className="gap-1.5"
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", duration: 0.2, bounce: 0.5 }}
          >
            <Plus className="h-4 w-4" />
            Add
          </MotionButton>
        </CardContent>
      </Card>

      {/* Task list */}
      <Card>
        <CardContent className="pt-4 overflow-hidden">
          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No tasks yet. Add one above!</p>
          ) : (
            <Reorder.Group
              axis="y"
              values={tasks}
              onReorder={handleReorder}
              className="space-y-2"
              data-testid="notes-list"
            >
              <AnimatePresence initial={false}>
                {tasks.map((task, idx) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    index={idx}
                    onToggle={toggleTask}
                    onDelete={deleteTask}
                    onRename={renameTask}
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      {tasks.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-xs text-muted-foreground"
        >
          {tasks.filter((t) => t.completed).length} of {tasks.length} completed
        </motion.div>
      )}
    </>
  );

  return (
    <div
      className={termWs ? "mx-auto max-w-6xl space-y-3 p-3" : "mx-auto max-w-md space-y-3 p-3"}
      data-testid="notes-page"
    >
      {termWs ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>{webApp}</div>
            <XtermPane title="Terminal 1" wsUrl={`${termWs}/term/shell`} testId="xterm-term1" className="h-[520px]" />
          </div>
          <XtermPane title="Terminal 2" wsUrl={`${termWs}/term/shell`} testId="xterm-term2" className="h-[260px]" />
        </div>
      ) : (
        webApp
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page (resolves doc URL then renders NotesList)                     */
/* ------------------------------------------------------------------ */

export default function NotesPage() {
  const docUrl = useNotesDoc();

  if (!docUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Initializing document…
      </div>
    );
  }

  return <NotesList docUrl={docUrl} />;
}
