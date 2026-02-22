/**
 * @description Chat page synced between two users via Automerge.
 * URL params: ?role=alice|bob&ws=... + #automerge:docHash
 */
import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Wifi, MessageCircle } from "lucide-react";
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
}: {
    msg: ChatMessage;
    isMine: boolean;
    index: number;
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
                    {msg.sender === "alice" ? "A" : "B"}
                </div>

                {/* Bubble */}
                <div className={`rounded-2xl border px-3.5 py-2 ${colors.bubble}`}>
                    <p className="text-sm leading-relaxed text-foreground">{msg.text}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground text-right">{time}</p>
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
/*  Chat view (needs docUrl)                                           */
/* ------------------------------------------------------------------ */

function ChatView({ docUrl }: { docUrl: AutomergeUrl }) {
    const role = getRoleFromURL();
    const [doc, changeDoc] = useDocument<ChatDoc>(docUrl, { suspense: true });
    const [inputValue, setInputValue] = useState("");
    const [lastSeenCount, setLastSeenCount] = useState(0);
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

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        },
        [sendMessage],
    );

    const colors = ROLE_COLORS[role];

    return (
        <div className="flex flex-col h-[calc(100vh-3rem)]" data-testid="chat-page">
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
                            />
                        ))}
                    </AnimatePresence>
                )}
            </div>

            {/* Input bar */}
            <div className="border-t border-zinc-800 px-4 py-3">
                <div className="flex items-center gap-2">
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
