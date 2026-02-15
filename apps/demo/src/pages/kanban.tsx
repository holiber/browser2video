/**
 * @description Kanban board page for narrated video demos.
 * Uses pointer events for drag-and-drop (works with Playwright mouse simulation).
 * All interactive elements have data-testid attributes for reliable automation.
 */
import { useState, useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface Card {
  id: string;
  title: string;
}

interface Column {
  id: string;
  title: string;
  color: string;
  cards: Card[];
}

// ---------------------------------------------------------------------------
//  Initial board state
// ---------------------------------------------------------------------------

const INITIAL_COLUMNS: Column[] = [
  { id: "backlog", title: "Backlog", color: "#737373", cards: [] },
  { id: "in-progress", title: "In Progress", color: "#3b82f6", cards: [] },
  { id: "code-review", title: "Code Review", color: "#eab308", cards: [] },
  { id: "done", title: "Done", color: "#22c55e", cards: [] },
  { id: "released", title: "Released", color: "#a855f7", cards: [] },
];

let cardIdCounter = 0;
function nextCardId() {
  return `card-${++cardIdCounter}`;
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function KanbanPage() {
  const [columns, setColumns] = useState<Column[]>(INITIAL_COLUMNS);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragSourceCol = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Expose a global API for programmatic card moves (automation fallback)
  useEffect(() => {
    (window as any).__kanban = {
      moveCard: (cardId: string, toColumnId: string) => {
        setColumns((prev) => {
          let card: Card | undefined;
          const next = prev.map((col) => {
            const idx = col.cards.findIndex((c) => c.id === cardId);
            if (idx !== -1) {
              card = col.cards[idx];
              return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
            }
            return col;
          });
          if (!card) return prev;
          return next.map((col) =>
            col.id === toColumnId
              ? { ...col, cards: [...col.cards, card!] }
              : col,
          );
        });
      },
      addCard: (columnId: string, title: string) => {
        setColumns((prev) =>
          prev.map((col) =>
            col.id === columnId
              ? { ...col, cards: [...col.cards, { id: nextCardId(), title }] }
              : col,
          ),
        );
      },
    };
    return () => { delete (window as any).__kanban; };
  }, []);

  // ---- Add card ----
  const startAdd = useCallback((colId: string) => {
    setAddingTo(colId);
    setNewCardTitle("");
  }, []);

  const confirmAdd = useCallback(() => {
    if (!addingTo || !newCardTitle.trim()) return;
    setColumns((prev) =>
      prev.map((col) =>
        col.id === addingTo
          ? { ...col, cards: [...col.cards, { id: nextCardId(), title: newCardTitle.trim() }] }
          : col,
      ),
    );
    setAddingTo(null);
    setNewCardTitle("");
  }, [addingTo, newCardTitle]);

  const cancelAdd = useCallback(() => {
    setAddingTo(null);
    setNewCardTitle("");
  }, []);

  // ---- Drag-and-drop via pointer events ----
  const handleDragStart = useCallback(
    (cardId: string, sourceColId: string) => {
      setDragCardId(cardId);
      dragSourceCol.current = sourceColId;
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragCardId) return;
      const board = boardRef.current;
      if (!board) return;
      const cols = board.querySelectorAll<HTMLElement>("[data-column-id]");
      let found: string | null = null;
      for (const col of cols) {
        const rect = col.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          found = col.dataset.columnId ?? null;
          break;
        }
      }
      setDragOverCol(found);
    },
    [dragCardId],
  );

  const handlePointerUp = useCallback(() => {
    if (!dragCardId || !dragOverCol) {
      setDragCardId(null);
      setDragOverCol(null);
      return;
    }

    setColumns((prev) => {
      let card: Card | undefined;
      const next = prev.map((col) => {
        const idx = col.cards.findIndex((c) => c.id === dragCardId);
        if (idx !== -1) {
          card = col.cards[idx];
          return { ...col, cards: col.cards.filter((c) => c.id !== dragCardId) };
        }
        return col;
      });
      if (!card) return prev;
      return next.map((col) =>
        col.id === dragOverCol
          ? { ...col, cards: [...col.cards, card!] }
          : col,
      );
    });

    setDragCardId(null);
    setDragOverCol(null);
    dragSourceCol.current = null;
  }, [dragCardId, dragOverCol]);

  // Release drag on pointer up anywhere
  useEffect(() => {
    if (!dragCardId) return;
    const up = () => handlePointerUp();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [dragCardId, handlePointerUp]);

  return (
    <div
      data-testid="kanban-board"
      ref={boardRef}
      className="flex h-[calc(100vh-3rem)] flex-col"
      onPointerMove={handlePointerMove}
    >
      {/* Board header */}
      <div
        data-testid="kanban-header"
        className="flex items-center gap-3 border-b px-6 py-3"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
          K
        </div>
        <h1 className="text-lg font-semibold">Kanban Board</h1>
        <span className="text-sm text-muted-foreground">
          Task Lifecycle Demo
        </span>
      </div>

      {/* Board columns */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-6">
        {columns.map((col) => (
          <div
            key={col.id}
            data-testid={`column-${col.id}`}
            data-column-id={col.id}
            className="flex w-72 shrink-0 flex-col rounded-xl border transition-colors duration-200"
            style={{
              borderColor:
                dragOverCol === col.id && dragCardId
                  ? col.color
                  : undefined,
              background:
                dragOverCol === col.id && dragCardId
                  ? "var(--kanban-bg-drop)"
                  : "var(--kanban-bg-column)",
            }}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-3">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: col.color }}
              />
              <h2
                data-testid={`column-title-${col.id}`}
                className="text-sm font-medium"
              >
                {col.title}
              </h2>
              <span
                data-testid={`column-count-${col.id}`}
                className="ml-auto text-xs text-muted-foreground"
              >
                {col.cards.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {col.cards.map((card) => (
                <div
                  key={card.id}
                  data-testid={`card-${card.id}`}
                  data-card-id={card.id}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleDragStart(card.id, col.id);
                  }}
                  className="cursor-grab select-none rounded-lg border px-3 py-2.5 text-sm transition-all duration-150 active:cursor-grabbing"
                  style={{
                    borderColor:
                      dragCardId === card.id
                        ? "var(--kanban-accent)"
                        : undefined,
                    background:
                      dragCardId === card.id
                        ? "var(--kanban-bg-hover)"
                        : "var(--kanban-bg-card)",
                    opacity: dragCardId === card.id ? 0.6 : 1,
                  }}
                >
                  {card.title}
                </div>
              ))}

              {/* Add card form */}
              {addingTo === col.id ? (
                <div data-testid={`add-card-form-${col.id}`} className="flex flex-col gap-2">
                  <input
                    data-testid={`add-card-input-${col.id}`}
                    type="text"
                    autoFocus
                    placeholder="Enter card title..."
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                    className="rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{
                      background: "var(--kanban-bg-card)",
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      data-testid={`add-card-confirm-${col.id}`}
                      onClick={confirmAdd}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors"
                      style={{ background: "var(--kanban-accent)" }}
                    >
                      Add Card
                    </button>
                    <button
                      data-testid={`add-card-cancel-${col.id}`}
                      onClick={cancelAdd}
                      className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  data-testid={`add-card-btn-${col.id}`}
                  onClick={() => startAdd(col.id)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/30"
                >
                  <span className="text-base leading-none">+</span> New card
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
