/**
 * @description Chat page synced between two users via Automerge.
 * URL params: ?role=alice|bob&ws=... + #automerge:docHash
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Wifi, MessageCircle, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    useDocument,
    useRepo,
    isValidAutomergeUrl,
    type AutomergeUrl,
} from "@/lib/use-automerge";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatMessage {
    id: string;
    sender: "alice" | "bob";
    text: string;
    image?: string;
    ts: number;
}

interface ChatDoc {
    messages: ChatMessage[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getRoleFromURL(): "alice" | "bob" {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");
    if (role === "alice" || role === "bob") return role;
    return "alice";
}

let msgCounter = 0;
function nextMsgId(): string {
    msgCounter += 1;
    return `msg-${Date.now()}-${msgCounter}`;
}

const ROLE_COLORS = {
    alice: {
        bg: "bg-violet-500/20",
        border: "border-violet-500/30",
        name: "text-violet-400",
        bubble: "bg-violet-600/30 border-violet-500/20",
        avatar: "bg-violet-500",
    },
    bob: {
        bg: "bg-sky-500/20",
        border: "border-sky-500/30",
        name: "text-sky-400",
        bubble: "bg-sky-600/30 border-sky-500/20",
        avatar: "bg-sky-500",
    },
} as const;

const ROLE_LABELS = { alice: "Alice 👩", bob: "Bob 👨‍💻" } as const;

/* ------------------------------------------------------------------ */
/*  Hook: find or create the shared Automerge document via URL hash    */
/* ------------------------------------------------------------------ */

function useChatDoc(): AutomergeUrl | null {
    const repo = useRepo();
    const [docUrl, setDocUrl] = useState<AutomergeUrl | null>(null);

    useEffect(() => {
        const hash = document.location.hash.substring(1);
        if (isValidAutomergeUrl(hash)) {
            repo.find<ChatDoc>(hash as AutomergeUrl);
            setDocUrl(hash as AutomergeUrl);
        } else {
            const handle = repo.create<ChatDoc>({ messages: [] });
            document.location.hash = handle.url;
            setDocUrl(handle.url);
        }
    }, [repo]);

    return docUrl;
}

/* ------------------------------------------------------------------ */
/*  Message bubble                                                     */
/* ------------------------------------------------------------------ */

function MessageBubble({
    msg,
    isMine,
    index,
    liked,
    onLike,
}: {
    msg: ChatMessage;
    isMine: boolean;
    index: number;
    liked: boolean;
    onLike: (id: string) => void;
}) {
    const colors = ROLE_COLORS[msg.sender];
    const time = new Date(msg.ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <motion.div
            className={`flex ${isMine ? "justify-end" : "justify-start"}`}
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            data-testid={`chat-msg-${index}`}
        >
            <div className={`flex items-end gap-2 max-w-[75%] ${isMine ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <div
                    className={`h-7 w-7 shrink-0 rounded-full ${colors.avatar} flex items-center justify-center text-[11px] font-bold text-white`}
                >
                    {msg.sender === "alice" ? "V" : "B"}
                </div>

                {/* Bubble + reaction */}
                <div className="flex flex-col gap-0.5">
                    <div className={`group relative rounded-2xl border px-3.5 py-2 ${colors.bubble}`}>
                        {msg.image && (
                            <img
                                src={msg.image}
                                alt="sketch"
                                className="rounded-lg mb-1 max-w-full"
                                data-testid={`chat-img-${index}`}
                            />
                        )}
                        <p className="text-sm leading-relaxed text-foreground">{msg.text}</p>
                        <div className="flex items-center justify-between mt-0.5 gap-2">
                            <p className="text-[10px] text-muted-foreground">{time}</p>
                            {!isMine && (
                                <button
                                    onClick={() => onLike(msg.id)}
                                    data-testid={`chat-react-${index}`}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:scale-125 active:scale-95"
                                >
                                    {liked ? "❤️" : "🤍"}
                                </button>
                            )}
                        </div>
                    </div>
                    <AnimatePresence>
                        {liked && (
                            <motion.div
                                className={`text-xs ${isMine ? "text-right" : "text-left"} px-1`}
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                            >
                                ❤️
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </motion.div>
    );
}

/* ------------------------------------------------------------------ */
/*  Notification badge                                                 */
/* ------------------------------------------------------------------ */

function NotificationBadge({ count }: { count: number }) {
    if (count <= 0) return null;
    return (
        <motion.div
            className="fixed top-3 right-3 z-50 flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            data-testid="chat-notification"
        >
            <MessageCircle className="h-3.5 w-3.5" />
            {count} new {count === 1 ? "message" : "messages"}
        </motion.div>
    );
}

/* ------------------------------------------------------------------ */
/*  Sketchpad                                                          */
/* ------------------------------------------------------------------ */

function Sketchpad({ onSend }: { onSend?: (dataUrl: string) => void }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const lastPt = useRef<{ x: number; y: number } | null>(null);

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
        const c = canvasRef.current!;
        const r = c.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (c.width / r.width),
            y: (e.clientY - r.top) * (c.height / r.height),
        };
    }

    function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
        drawing.current = true;
        lastPt.current = getPos(e);
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    }

    function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
        if (!drawing.current) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx || !lastPt.current) return;
        const pt = getPos(e);
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lastPt.current.x, lastPt.current.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        lastPt.current = pt;
    }

    function onUp() {
        drawing.current = false;
        lastPt.current = null;
    }

    function handleSend() {
        const c = canvasRef.current;
        if (!c || !onSend) return;
        onSend(c.toDataURL("image/png"));
    }

    return (
        <div className="border border-zinc-700 rounded-lg overflow-hidden" data-testid="chat-sketchpad">
            <canvas
                ref={canvasRef}
                width={400}
                height={200}
                className="w-full bg-zinc-900/60 cursor-crosshair"
                style={{ touchAction: "none" }}
                data-testid="chat-sketch"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
            />
            {onSend && (
                <div className="flex justify-end px-2 py-1.5 bg-zinc-900/40">
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleSend}
                        data-testid="chat-sketch-send"
                        className="text-xs"
                    >
                        <Send className="h-3 w-3 mr-1" />
                        Send sketch
                    </Button>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Chat view (needs docUrl)                                           */
/* ------------------------------------------------------------------ */

function ChatView({ docUrl }: { docUrl: AutomergeUrl }) {
    const role = getRoleFromURL();
    const [doc, changeDoc] = useDocument<ChatDoc>(docUrl, { suspense: true });
    const [inputValue, setInputValue] = useState("");
    const [lastSeenCount, setLastSeenCount] = useState(0);
    const [sketchOpen, setSketchOpen] = useState(false);
    const [likedMessages, setLikedMessages] = useState<Set<string>>(new Set());
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const messages = doc?.messages ?? [];
    const unreadCount = messages.filter((m) => m.sender !== role).length - lastSeenCount;

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [messages.length]);

    // Mark messages as seen when we have focus
    useEffect(() => {
        const otherCount = messages.filter((m) => m.sender !== role).length;
        if (otherCount > lastSeenCount) {
            setLastSeenCount(otherCount);
        }
    }, [messages, role, lastSeenCount]);

    const sendMessage = useCallback(() => {
        const text = inputValue.trim();
        if (!text) return;
        changeDoc((d) => {
            d.messages.push({
                id: nextMsgId(),
                sender: role,
                text,
                ts: Date.now(),
            });
        });
        setInputValue("");
        inputRef.current?.focus();
    }, [inputValue, changeDoc, role]);

    const sendSketch = useCallback((dataUrl: string) => {
        changeDoc((d) => {
            d.messages.push({
                id: nextMsgId(),
                sender: role,
                text: "",
                image: dataUrl,
                ts: Date.now(),
            });
        });
        setSketchOpen(false);
    }, [changeDoc, role]);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        },
        [sendMessage],
    );

    const toggleLike = useCallback((msgId: string) => {
        setLikedMessages((prev) => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    const colors = ROLE_COLORS[role];

    return (
        <div className="flex flex-col h-full" data-testid="chat-page">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                    <MessageCircle className="h-5 w-5 text-muted-foreground" />
                    <h1 className="text-base font-semibold">Chat</h1>
                    <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.name} border ${colors.border}`}
                        data-testid="chat-role"
                    >
                        {ROLE_LABELS[role]}
                    </span>
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs text-green-500">
                    <Wifi className="h-3.5 w-3.5" />
                    Synced
                </div>
            </div>

            {/* Messages area */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
                data-testid="chat-messages"
            >
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                        No messages yet. Say something! 💬
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {messages.map((msg, idx) => (
                            <MessageBubble
                                key={msg.id}
                                msg={msg}
                                isMine={msg.sender === role}
                                index={idx}
                                liked={likedMessages.has(msg.id)}
                                onLike={toggleLike}
                            />
                        ))}
                    </AnimatePresence>
                )}
            </div>

            {/* Sketchpad */}
            <AnimatePresence>
                {sketchOpen && (
                    <motion.div
                        className="px-4 pt-2"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <Sketchpad onSend={sendSketch} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Input bar */}
            <div className="border-t border-zinc-800 px-4 py-3">
                <div className="flex items-center gap-2">
                    <Button
                        variant={sketchOpen ? "secondary" : "ghost"}
                        size="icon"
                        onClick={() => setSketchOpen((v) => !v)}
                        data-testid="chat-sketch-toggle"
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Input
                        ref={inputRef}
                        placeholder="Type a message…"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        data-testid="chat-input"
                        className="flex-1"
                    />
                    <Button
                        onClick={sendMessage}
                        size="icon"
                        data-testid="chat-send"
                        disabled={!inputValue.trim()}
                    >
                        <Send className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Notification badge */}
            <AnimatePresence>
                {unreadCount > 0 && <NotificationBadge count={unreadCount} />}
            </AnimatePresence>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ChatPage() {
    const docUrl = useChatDoc();

    if (!docUrl) {
        return (
            <div className="flex min-h-screen items-center justify-center text-muted-foreground">
                Initializing chat…
            </div>
        );
    }

    return <ChatView docUrl={docUrl} />;
}
