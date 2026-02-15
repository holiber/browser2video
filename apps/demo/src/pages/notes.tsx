/**
 * @description Collaborative todo-list page synced between tabs via Automerge Repo.
 * Uses @automerge/react with BroadcastChannel for real-time cross-tab sync.
 * The document is shared via the URL hash (#automerge:...).
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { motion, Reorder, AnimatePresence } from "framer-motion";
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
import { XtermPane } from "@/components/xterm-pane";
import { ConsolePanel } from "@/components/console-panel";

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

function getRoleFromURL(): "boss" | "worker" | null {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role");
  if (role === "boss" || role === "worker") return role;
  return null;
}

function getTermWsFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("termWs");
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getShowConsoleFromURL(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("showConsole") === "true";
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
        {task.approved ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : task.completed ? (
          <CheckCircle2 className="h-5 w-5 text-amber-400" />
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
          className="flex-1 text-sm leading-5"
          onDoubleClick={() => {
            setEditValue(task.title);
            setEditing(true);
          }}
          data-testid={`note-title-${index}`}
        >
          <div className="flex items-center gap-2">
            <span className={
              task.approved
                ? "text-emerald-400"
                : task.completed
                  ? "text-amber-400"
                  : ""
            }>
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
/*  Notes list (needs a docUrl to use useDocument)                     */
/* ------------------------------------------------------------------ */

function NotesList({ docUrl, termWs, showConsole }: { docUrl: AutomergeUrl; termWs: string | null; showConsole: boolean }) {
  const role = getRoleFromURL();
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
    console.log(`Task created: "${title}"`);
    setInputValue("");
  }, [inputValue, changeDoc]);

  const toggleTask = useCallback(
    (index: number) => {
      const task = doc?.tasks[index];
      const willComplete = task ? !task.completed : true;
      changeDoc((d) => {
        d.tasks[index].completed = !d.tasks[index].completed;
      });
      if (task) {
        console.log(`Task ${willComplete ? "completed" : "uncompleted"}: "${task.title}"`);
      }
    },
    [changeDoc, doc],
  );

  const deleteTask = useCallback(
    (index: number) => {
      const task = doc?.tasks[index];
      changeDoc((d) => {
        d.tasks.splice(index, 1);
      });
      if (task) {
        console.log(`Task deleted: "${task.title}"`);
      }
    },
    [changeDoc, doc],
  );

  const renameTask = useCallback(
    (index: number, title: string) => {
      const oldTitle = doc?.tasks[index]?.title;
      changeDoc((d) => {
        d.tasks[index].title = title;
      });
      console.log(`Task renamed: "${oldTitle}" → "${title}"`);
    },
    [changeDoc, doc],
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
        console.log(`Tasks reordered: [${ids.map((id) => taskMap.get(id)?.title).join(", ")}]`);
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

  const hasBelowPanel = !!termWs || showConsole;

  return (
    <div className={hasBelowPanel ? "flex flex-col h-[calc(100vh-3rem)]" : ""} data-testid="notes-root">
      <div
        className={`mx-auto max-w-md space-y-3 p-3 ${hasBelowPanel ? "flex-1 min-h-0 overflow-y-auto" : ""}`}
        data-testid="notes-page"
      >
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
      </div>

      {/* Optional terminal pane */}
      {termWs && (
        <XtermPane
          title="Terminal"
          wsUrl={`${termWs}/term/shell`}
          testId="xterm-notes-terminal"
          className="h-[200px] shrink-0 border-t"
        />
      )}

      {/* Optional DevTools-style console panel */}
      {showConsole && (
        <ConsolePanel
          testId="console-panel"
          className="shrink-0 border-t border-[#3c3c3c]"
          style={{ height: "40%" }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page (resolves doc URL then renders NotesList)                     */
/* ------------------------------------------------------------------ */

export default function NotesPage() {
  const docUrl = useNotesDoc();
  const termWs = getTermWsFromURL();
  const showConsole = getShowConsoleFromURL();

  if (!docUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Initializing document…
      </div>
    );
  }

  return <NotesList docUrl={docUrl} termWs={termWs} showConsole={showConsole} />;
}
