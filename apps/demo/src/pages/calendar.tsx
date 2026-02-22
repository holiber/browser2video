/**
 * @description Simple weekly calendar page.
 * Shows a week grid with some events — Friday is empty (Bob is free).
 * URL param: ?role=bob for personalization.
 */
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface CalEvent {
    title: string;
    time: string;
    color: string;
    icon?: "clock" | "pin";
}

const EVENTS: Record<string, CalEvent[]> = {
    Mon: [
        { title: "Team standup", time: "9:00 – 9:30", color: "bg-sky-500/20 border-sky-500/30 text-sky-300" },
        { title: "Code review", time: "14:00 – 15:00", color: "bg-violet-500/20 border-violet-500/30 text-violet-300" },
    ],
    Tue: [
        { title: "Sprint planning", time: "10:00 – 11:30", color: "bg-amber-500/20 border-amber-500/30 text-amber-300" },
    ],
    Wed: [
        { title: "1:1 with manager", time: "11:00 – 11:30", color: "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" },
        { title: "Design sync", time: "15:00 – 16:00", color: "bg-pink-500/20 border-pink-500/30 text-pink-300" },
    ],
    Thu: [
        { title: "Demo prep", time: "13:00 – 14:00", color: "bg-orange-500/20 border-orange-500/30 text-orange-300" },
        { title: "Gym 🏋️", time: "18:00 – 19:30", color: "bg-lime-500/20 border-lime-500/30 text-lime-300", icon: "pin" },
    ],
    Fri: [], // Empty — Bob is free!
    Sat: [
        { title: "Groceries", time: "11:00", color: "bg-zinc-500/20 border-zinc-500/30 text-zinc-300", icon: "pin" },
    ],
    Sun: [],
};

// Current-ish date for display (Friday of current week)
function getWeekDates(): string[] {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    return DAYS.map((_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return `${d.getDate()}`;
    });
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function EventCard({ event }: { event: CalEvent }) {
    const IconEl = event.icon === "pin" ? MapPin : Clock;
    return (
        <div
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${event.color}`}
            data-testid="cal-event"
        >
            <p className="font-medium">{event.title}</p>
            <p className="mt-0.5 flex items-center gap-1 opacity-70">
                <IconEl className="h-3 w-3" />
                {event.time}
            </p>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
    const dates = getWeekDates();
    const today = new Date().getDay(); // 0=Sun
    const todayIdx = today === 0 ? 6 : today - 1; // 0=Mon

    return (
        <div className="p-4 max-w-4xl mx-auto" data-testid="calendar-page">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-4">
                <CalendarDays className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-lg font-semibold">My Calendar</h1>
                <span className="text-xs text-muted-foreground ml-auto">This week</span>
            </div>

            {/* Week grid */}
            <div className="grid grid-cols-7 gap-2">
                {DAYS.map((day, i) => {
                    const events = EVENTS[day] ?? [];
                    const isToday = i === todayIdx;
                    const isFriday = day === "Fri";

                    return (
                        <Card
                            key={day}
                            className={`min-h-[180px] ${isToday ? "border-sky-500/50 ring-1 ring-sky-500/20" : ""
                                } ${isFriday ? "border-emerald-500/40 ring-1 ring-emerald-500/15" : ""}`}
                            data-testid={`cal-day-${day.toLowerCase()}`}
                        >
                            <CardContent className="p-2.5 pt-2.5">
                                {/* Day header */}
                                <div className="flex items-center justify-between mb-2">
                                    <span className={`text-xs font-semibold ${isToday ? "text-sky-400" : "text-muted-foreground"}`}>
                                        {day}
                                    </span>
                                    <span
                                        className={`text-xs ${isToday
                                                ? "bg-sky-500 text-white rounded-full w-5 h-5 flex items-center justify-center font-bold"
                                                : "text-muted-foreground"
                                            }`}
                                    >
                                        {dates[i]}
                                    </span>
                                </div>

                                {/* Events */}
                                <div className="space-y-1.5">
                                    {events.map((ev, j) => (
                                        <EventCard key={j} event={ev} />
                                    ))}
                                    {events.length === 0 && (
                                        <p
                                            className={`text-[11px] text-center py-6 ${isFriday ? "text-emerald-400/60" : "text-muted-foreground/40"
                                                }`}
                                            data-testid={isFriday ? "cal-friday-free" : undefined}
                                        >
                                            {isFriday ? "✨ Free!" : "—"}
                                        </p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
