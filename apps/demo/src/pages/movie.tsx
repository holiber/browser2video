/**
 * @description Movie description page for the streaming app.
 * Shows "3 Body Problem" series info — used by the chat scenario as Veronica's starting view.
 * Device chrome (title bar, dock) is handled by MacOSChrome layout wrapper.
 *
 * URL params: ?role=veronica|bob&ws=... (passed through to the chat page)
 */
import { Play, Plus, Star, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

const GENRES = ["Sci-Fi", "Drama", "Mystery", "Thriller"];

const CAST = [
  { name: "Jovan Adepo", initials: "JA", color: "bg-sky-600" },
  { name: "John Bradley", initials: "JB", color: "bg-amber-600" },
  { name: "Rosalind Chao", initials: "RC", color: "bg-rose-600" },
  { name: "Liam Cunningham", initials: "LC", color: "bg-emerald-600" },
  { name: "Eiza González", initials: "EG", color: "bg-violet-600" },
  { name: "Benedict Wong", initials: "BW", color: "bg-orange-600" },
];

export default function MoviePage() {
  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none" data-testid="movie-page">
      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          <div className="h-56 bg-gradient-to-b from-indigo-950/60 via-indigo-950/30 to-zinc-950" />
          <div className="absolute inset-0 flex items-end px-6 pb-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg" data-testid="movie-title">
                3 Body Problem
              </h1>
              <div className="flex items-center gap-2 mt-2 text-sm text-zinc-400">
                <span>2024</span>
                <span className="text-zinc-600">·</span>
                <span className="rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                  TV-MA
                </span>
                <span className="text-zinc-600">·</span>
                <span>1 Season</span>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ))}
                <Star className="h-3.5 w-3.5 fill-zinc-700 text-zinc-600" />
                <span className="ml-1.5 text-sm text-zinc-400">8.0 / 10</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Actions ──────────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-4">
          <Button className="gap-2 rounded-full" data-testid="movie-play">
            <Play className="h-4 w-4 fill-current" />
            Play
          </Button>
          <Button variant="outline" className="gap-2 rounded-full" data-testid="movie-mylist">
            <Plus className="h-4 w-4" />
            My List
          </Button>
        </div>

        {/* ── Genres ───────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 px-6 pb-4">
          {GENRES.map((g) => (
            <span
              key={g}
              className="rounded-full bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-300"
            >
              {g}
            </span>
          ))}
        </div>

        {/* ── Synopsis ─────────────────────────────────────────── */}
        <div className="px-6 pb-4" data-testid="movie-synopsis">
          <h2 className="text-sm font-semibold text-zinc-300 mb-1.5">Synopsis</h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            A young woman&rsquo;s fateful decision in 1960s China reverberates across space and time
            to a group of brilliant scientists in the present day. As the laws of nature unravel
            before their eyes, five former classmates reunite to confront the greatest threat in
            humanity&rsquo;s history. Based on the acclaimed novel by Liu Cixin.
          </p>
        </div>

        {/* ── Creators ─────────────────────────────────────────── */}
        <div className="px-6 pb-4">
          <h2 className="text-sm font-semibold text-zinc-300 mb-1">Creators</h2>
          <p className="text-sm text-zinc-500">
            David Benioff &middot; D.B. Weiss &middot; Alexander Woo
          </p>
        </div>

        {/* ── Episode info ─────────────────────────────────────── */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> 52–65 min / episode
            </span>
            <span>8 episodes</span>
          </div>
        </div>

        {/* ── Cast ─────────────────────────────────────────────── */}
        <div className="px-6 pb-8" data-testid="movie-cast">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Cast</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {CAST.map((c) => (
              <div key={c.name} className="flex flex-col items-center gap-1.5 shrink-0">
                <div
                  className={`h-12 w-12 rounded-full ${c.color} flex items-center justify-center text-sm font-bold text-white`}
                >
                  {c.initials}
                </div>
                <span className="text-[11px] text-zinc-500 text-center w-14 truncate">
                  {c.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
