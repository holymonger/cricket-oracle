"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface MatchSummary {
  id: string;
  name: string;
  matchType: string;
  status: string;
  venue: string;
  date: string;
  teams: [string, string];
  teamInfo: Array<{ name: string; shortname: string; img: string }>;
  score: Array<{ r: number; w: number; o: number; inning: string }>;
  matchStarted: boolean;
  matchEnded: boolean;
}

type Filter = "all" | "live" | "t20" | "odi" | "test";

function MatchCard({ match: m, onClick }: { match: MatchSummary; onClick: () => void }) {
  const isLive = m.matchStarted && !m.matchEnded;
  const isEnded = m.matchEnded;

  const formatColor =
    m.matchType === "t20"  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
    m.matchType === "odi"  ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
    m.matchType === "test" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                             "bg-gray-500/20 text-gray-400 border-gray-500/30";

  // Map score entries back to teams by parsing inning string
  const scoreForTeam = (idx: number) => {
    if (!m.score.length) return null;
    return m.score[idx] ?? null;
  };

  const teamAScore = scoreForTeam(0);
  const teamBScore = scoreForTeam(1);

  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/25 rounded-2xl p-5 transition-all duration-200"
    >
      {/* Top row: format + status */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border tracking-wider ${formatColor}`}>
          {m.matchType.toUpperCase()}
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            LIVE
          </span>
        )}
        {isEnded && <span className="text-[10px] font-medium text-gray-600 tracking-wider">ENDED</span>}
        {!m.matchStarted && <span className="text-[10px] font-medium text-gray-600 tracking-wider">UPCOMING</span>}
      </div>

      {/* Teams + scores */}
      <div className="space-y-2 mb-4">
        {([m.teams[0], m.teams[1]] as [string, string]).map((team, i) => {
          const sc = i === 0 ? teamAScore : teamBScore;
          return (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm text-white/90 truncate">{team}</span>
              {sc ? (
                <span className="text-sm font-mono text-white/70 shrink-0">
                  {sc.r}/{sc.w}
                  <span className="text-white/35 text-xs"> ({sc.o})</span>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Status text */}
      <p className="text-[11px] text-white/35 truncate mb-3 leading-relaxed">{m.status}</p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-white/25 truncate pr-2">
          {m.venue?.split(",")[0]}
        </span>
        <span className="text-[11px] text-blue-400/70 group-hover:text-blue-400 transition-colors shrink-0 font-medium">
          Analyse →
        </span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 space-y-4 animate-pulse">
      <div className="flex gap-2">
        <div className="h-4 w-10 bg-white/10 rounded-full" />
        <div className="h-4 w-10 bg-white/10 rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-3/4 bg-white/10 rounded" />
        <div className="h-4 w-1/2 bg-white/10 rounded" />
      </div>
      <div className="h-3 w-full bg-white/5 rounded" />
      <div className="h-3 w-1/3 bg-white/5 rounded" />
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  function loadMatches(force = false) {
    setLoading(true);
    setError("");
    fetch(`/api/live/matches?all=true${force ? "&force=true" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setMatches(d.matches ?? []);
        setCachedAt(d.cachedAt);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadMatches(); }, []);

  const filtered = matches.filter((m) => {
    if (filter === "live") return m.matchStarted && !m.matchEnded;
    if (filter === "t20")  return m.matchType === "t20";
    if (filter === "odi")  return m.matchType === "odi";
    if (filter === "test") return m.matchType === "test";
    return true;
  });

  const liveCount = matches.filter((m) => m.matchStarted && !m.matchEnded).length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/8 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏏</span>
              <h1 className="text-base font-bold tracking-tight text-white">Cricket Oracle</h1>
              {liveCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  {liveCount} LIVE
                </span>
              )}
            </div>
            <p className="text-[11px] text-white/35 mt-0.5">
              AI-powered win prediction · Live markets · Pre-match intelligence
            </p>
          </div>
          <nav className="flex items-center gap-1">
            <a href="/markets" className="text-xs text-white/50 hover:text-white/90 transition px-3 py-1.5 rounded-lg hover:bg-white/5">
              Markets
            </a>
            <a href="/match" className="text-xs text-white/50 hover:text-white/90 transition px-3 py-1.5 rounded-lg hover:bg-white/5">
              Simulator
            </a>
          </nav>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pt-12 pb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-1">
          {loading ? "Loading matches…" : `${filtered.length} match${filtered.length !== 1 ? "es" : ""}`}
        </h2>
        <p className="text-sm text-white/40">
          Select a match to see AI pre-match analysis, live win probability, and market intelligence.
        </p>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-white/[0.04] border border-white/10 rounded-xl p-1">
            {(["all", "live", "t20", "odi", "test"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filter === f
                    ? "bg-white text-gray-900"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {f === "all" ? "All" : f.toUpperCase()}
                {f === "live" && liveCount > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-[9px] px-1 rounded-full">
                    {liveCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => loadMatches(true)}
            disabled={loading}
            className="text-xs text-white/40 hover:text-white/70 border border-white/15 hover:border-white/30 px-3 py-1.5 rounded-lg transition disabled:opacity-40"
            title="Force fetch latest matches from CricAPI (costs 1 API hit)"
          >
            {loading ? "…" : "⟳ Refresh"}
          </button>
        </div>
        {cachedAt && (
          <p className="text-[10px] text-white/20 mt-2 ml-1">
            Cached {new Date(cachedAt).toLocaleTimeString()} · auto-refreshes daily
          </p>
        )}
      </div>

      {/* ── Match grid ──────────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-6 pb-16">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="bg-red-900/20 border border-red-500/20 rounded-2xl p-8 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-xs text-red-300 hover:text-red-200 underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🏏</div>
            <p className="text-white/40 text-sm">
              {filter !== "all" ? `No ${filter.toUpperCase()} matches` : "No matches right now"}
            </p>
            {filter !== "all" && (
              <button
                onClick={() => setFilter("all")}
                className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Show all matches
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                onClick={() => router.push(`/match/${m.id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
