"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface LiveState {
  innings: number;
  runs: number;
  wickets: number;
  balls: number;
  runRate: number;
  target: number | null;
  requiredRunRate: number | null;
  runsNeeded: number | null;
  ballsRemaining: number | null;
  battingTeamIdx: number | null;
  tossWinner?: string;
  tossChoice?: string;
  teams: [string, string];
  scorecard: Array<{ inning: string; r: number; w: number; o: number }>;
  matchStarted: boolean;
  matchEnded: boolean;
  matchWinner?: string;
}

interface BatsmanCard { name: string; runs: number; balls: number; fours: number; sixes: number; strikeRate: number; dismissal: string }
interface BowlerCard { name: string; overs: number; runs: number; wickets: number; economy: number; wides: number; noBalls: number }

interface InningsCard {
  innings: number;
  inningName: string;
  totalRuns: number;
  totalWickets: number;
  totalOvers: number;
  batting: BatsmanCard[];
  bowling: BowlerCard[];
}

interface RollbitData {
  eventId: number;
  home: string;
  away: string;
  league: string;
  homeOdds: number | null;
  awayOdds: number | null;
  homeFair: number | null;
  awayFair: number | null;
  teamAIsHome: boolean;
}

interface MatchDetail {
  matchId: string;
  name: string;
  matchType: string;
  status: string;
  venue: string;
  teams: [string, string];
  teamInfo: Array<{ name: string; shortname: string; img: string }>;
  liveState: LiveState;
  scorecard: InningsCard[];
  winProb: {
    teamAWinProb: number | null;
    teamBWinProb: number | null;
    teamAName: string;
    teamBName: string;
    modelVersion: string | null;
    isPreMatch: boolean;
    note: string | null;
  };
  rollbit: RollbitData | null;
  cache: {
    scorecardCachedAt: string | null;
    scorecardExpiresAt: string | null;
    forceRefreshed: boolean;
  };
  fetchedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function RollbitPanel({
  rollbit,
  modelProbA,
  teamA,
  teamB,
}: {
  rollbit: RollbitData;
  modelProbA: number | null;
  teamA: string;
  teamB: string;
}) {
  // Align rollbit home/away to teamA/teamB
  const aOdds  = rollbit.teamAIsHome ? rollbit.homeOdds  : rollbit.awayOdds;
  const bOdds  = rollbit.teamAIsHome ? rollbit.awayOdds  : rollbit.homeOdds;
  const aFair  = rollbit.teamAIsHome ? rollbit.homeFair  : rollbit.awayFair;
  const bFair  = rollbit.teamAIsHome ? rollbit.awayFair  : rollbit.homeFair;

  const fmt = (v: number | null, pct = false) =>
    v === null ? "—" : pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);

  const edge = (modelProb: number | null, marketFair: number | null) => {
    if (modelProb === null || marketFair === null) return null;
    return modelProb - marketFair;
  };

  const edgeA = edge(modelProbA, aFair);
  const edgeB = edge(modelProbA !== null ? 1 - modelProbA : null, bFair);

  const edgeColor = (e: number | null) =>
    e === null ? "text-gray-400" :
    e > 0.04 ? "text-green-600 font-bold" :
    e < -0.04 ? "text-red-500" : "text-gray-500";

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-orange-800 uppercase tracking-wide">Rollbit ML Odds</span>
        <span className="text-xs text-orange-500">{rollbit.league}</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left py-1">Team</th>
            <th className="text-right py-1">Odds</th>
            <th className="text-right py-1">Implied</th>
            <th className="text-right py-1">Fair</th>
            <th className="text-right py-1">Model</th>
            <th className="text-right py-1">Edge</th>
          </tr>
        </thead>
        <tbody>
          {([
            { name: teamA, odds: aOdds, fair: aFair, model: modelProbA, edgeVal: edgeA },
            { name: teamB, odds: bOdds, fair: bFair, model: modelProbA !== null ? 1 - modelProbA : null, edgeVal: edgeB },
          ] as const).map((row) => (
            <tr key={row.name} className="border-t border-orange-100">
              <td className="py-1.5 font-medium text-gray-800 truncate max-w-[80px]">{row.name}</td>
              <td className="py-1.5 text-right font-mono">{fmt(row.odds)}</td>
              <td className="py-1.5 text-right text-gray-500">{fmt(row.odds !== null ? 1 / row.odds : null, true)}</td>
              <td className="py-1.5 text-right text-gray-600">{fmt(row.fair, true)}</td>
              <td className="py-1.5 text-right text-blue-700">{fmt(row.model, true)}</td>
              <td className={`py-1.5 text-right ${edgeColor(row.edgeVal)}`}>
                {row.edgeVal === null ? "—" : `${row.edgeVal > 0 ? "+" : ""}${(row.edgeVal * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-gray-400">Edge = Model − Rollbit fair prob · Green &gt;4pp = value bet</div>
    </div>
  );
}

function WinProbBar({ teamA, probA, teamB }: { teamA: string; probA: number; teamB: string }) {
  const pctA = Math.round(probA * 100);
  const pctB = 100 - pctA;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-medium">
        <span>{teamA}</span>
        <span>{teamB}</span>
      </div>
      <div className="flex h-8 rounded-full overflow-hidden">
        <div
          className="bg-blue-600 flex items-center justify-center text-white text-sm font-bold transition-all duration-700"
          style={{ width: `${pctA}%` }}
        >
          {pctA >= 15 ? `${pctA}%` : ""}
        </div>
        <div
          className="bg-red-500 flex items-center justify-center text-white text-sm font-bold transition-all duration-700"
          style={{ width: `${pctB}%` }}
        >
          {pctB >= 15 ? `${pctB}%` : ""}
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{pctA}% win probability</span>
        <span>{pctB}% win probability</span>
      </div>
    </div>
  );
}

function ScoreDisplay({ state, teams }: { state: LiveState; teams: [string, string] }) {
  const battingTeam = state.battingTeamIdx !== null ? teams[state.battingTeamIdx] : "—";
  const overs = `${Math.floor(state.balls / 6)}.${state.balls % 6}`;

  return (
    <div className="grid grid-cols-2 gap-4 text-center">
      <div className="bg-blue-50 rounded-lg p-4">
        <div className="text-xs text-gray-500 mb-1">Batting</div>
        <div className="font-semibold text-sm truncate">{battingTeam}</div>
        <div className="text-3xl font-bold text-blue-800 mt-1">
          {state.runs}/{state.wickets}
        </div>
        <div className="text-sm text-gray-600 mt-1">({overs} ov) RR: {state.runRate.toFixed(2)}</div>
      </div>
      {state.target !== null ? (
        <div className="bg-orange-50 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Chase</div>
          <div className="text-sm font-medium text-orange-800">Target {state.target}</div>
          <div className="text-2xl font-bold text-orange-700 mt-1">
            Need {state.runsNeeded}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            from {state.ballsRemaining} balls · RRR {state.requiredRunRate?.toFixed(2)}
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">1st Innings</div>
          <div className="text-sm text-gray-600">Setting target</div>
          <div className="text-2xl font-bold text-gray-700 mt-1">
            {20 - Math.floor(state.balls / 6)} ov left
          </div>
          <div className="text-sm text-gray-600 mt-1">RR: {state.runRate.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LivePage() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [dataAge, setDataAge] = useState<string>("");

  const [activeTab, setActiveTab] = useState<"scorecard" | "bowling">("scorecard");

  // Load match list — always fetch all (live + upcoming + ended); filter client-side
  const loadMatches = useCallback(async (force = false) => {
    setMatchesLoading(true);
    setMatchesError("");
    try {
      const params = new URLSearchParams({ all: "true" });
      if (force) params.set("force", "true");
      const res = await fetch(`/api/live/matches?${params}`);
      if (!res.ok) { const d = await res.json(); setMatchesError(d.error || "Failed"); return; }
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (err: any) {
      setMatchesError(err.message);
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  // Load match detail — server cache is 20s (live) / 10min (ended)
  const loadDetail = useCallback(async (id: string, force = false) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const matchStarted = matches.find((m) => m.id === id)?.matchStarted ?? true;
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      if (!matchStarted) params.set("started", "false");
      const res = await fetch(`/api/live/match/${id}?${params}`);
      if (!res.ok) { const d = await res.json(); setDetailError(d.error || "Failed"); return; }
      const data: MatchDetail = await res.json();
      setDetail(data);
      setLastRefresh(new Date().toLocaleTimeString());
      // Show how old the underlying CricAPI data is
      if (data.cache.scorecardCachedAt) {
        const ageMs = Date.now() - new Date(data.cache.scorecardCachedAt).getTime();
        const ageSec = Math.round(ageMs / 1000);
        setDataAge(ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`);
      }
    } catch (err: any) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }, [matches]);

  // On mount, force-refresh so we always get the latest match list (24h cache may be stale)
  useEffect(() => { loadMatches(true); }, [loadMatches]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Auto-refresh: browser polls every 20s aligned with server cache TTL (paid tier)
  useEffect(() => {
    if (!autoRefresh || !selectedId || detail?.liveState.matchEnded) return;
    const interval = setInterval(() => loadDetail(selectedId), 20_000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedId, detail, loadDetail]);

  const wp = detail?.winProb;

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Live Cricket</h1>
          <p className="text-xs text-gray-500 mt-0.5">Powered by CricAPI · LightGBM win probability</p>
        </div>
        <div className="flex gap-2">
          <a href="/pre-match" className="text-sm text-blue-600 hover:underline px-3 py-2">Pre-Match</a>
          <a href="/markets" className="text-sm text-blue-600 hover:underline px-3 py-2">Markets</a>
          <a href="/match" className="text-sm text-blue-600 hover:underline px-3 py-2">Simulator</a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Match List ──────────────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm text-gray-700">
              Matches ({matches.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => loadMatches(false)}
                disabled={matchesLoading}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
                title="Use cached list (no API hit)"
              >
                {matchesLoading ? "…" : "↻"}
              </button>
              <button
                onClick={() => loadMatches(true)}
                disabled={matchesLoading}
                className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 px-2 py-1 rounded font-medium"
                title="Force refresh from CricAPI (costs 1 hit)"
              >
                Force
              </button>
            </div>
          </div>

          {matchesError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{matchesError}</div>
          )}

          {matches.length === 0 && !matchesLoading ? (
            <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-lg text-center">
              No matches right now.<br />
              <button onClick={() => loadMatches(true)} className="text-blue-600 text-xs mt-1 hover:underline">
                Force refresh from CricAPI
              </button>
            </div>
          ) : (() => {
            const live = matches.filter((m) => m.matchStarted && !m.matchEnded);
            const upcoming = matches.filter((m) => !m.matchStarted && !m.matchEnded);
            const ended = matches.filter((m) => m.matchEnded);
            const renderMatch = (m: MatchSummary) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`w-full text-left p-3 rounded-lg border transition ${
                  selectedId === m.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    m.matchType === "t20" ? "bg-green-100 text-green-700" :
                    m.matchType === "odi" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {m.matchType.toUpperCase()}
                  </span>
                  {m.matchStarted && !m.matchEnded && (
                    <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium animate-pulse">LIVE</span>
                  )}
                  {!m.matchStarted && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">UPCOMING</span>
                  )}
                </div>
                <div className="font-medium text-sm leading-tight">
                  {m.teams[0]} vs {m.teams[1]}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{m.status}</div>
                {m.score.length > 0 && (
                  <div className="text-xs font-mono text-gray-700 mt-1">
                    {m.score.map((s) => `${s.r}/${s.w} (${s.o})`).join(" · ")}
                  </div>
                )}
              </button>
            );
            return (
              <div className="space-y-3">
                {upcoming.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">Upcoming ({upcoming.length})</div>
                    {upcoming.map(renderMatch)}
                  </div>
                )}
                {live.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-red-600 uppercase tracking-wide">Live ({live.length})</div>
                    {live.map(renderMatch)}
                  </div>
                )}
                {ended.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ended ({ended.length})</div>
                    {ended.map(renderMatch)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* ── Match Detail ─────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedId ? (
            <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-gray-400 text-sm">Select a match to see live scorecard + win probability</p>
            </div>
          ) : detailLoading && !detail ? (
            <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg">
              <p className="text-gray-400 text-sm">Loading match data…</p>
            </div>
          ) : detailError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{detailError}</div>
          ) : detail ? (
            <>
              {/* Match header */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="font-bold text-lg leading-tight">{detail.teams[0]} vs {detail.teams[1]}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{detail.venue}</p>
                    <p className="text-sm text-gray-600 mt-1">{detail.status}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoRefresh}
                        onChange={(e) => setAutoRefresh(e.target.checked)}
                        className="rounded"
                      />
                      Auto (20s)
                    </label>
                    <button
                      onClick={() => loadDetail(selectedId, false)}
                      disabled={detailLoading}
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded font-medium"
                      title="Read from server cache — no CricAPI hit"
                    >
                      {detailLoading ? "…" : "↻ Cached"}
                    </button>
                    <button
                      onClick={() => loadDetail(selectedId, true)}
                      disabled={detailLoading}
                      className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded font-medium"
                      title="Force fresh data from CricAPI (costs 1 API hit)"
                    >
                      ⚡ Force
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
                  {lastRefresh && <span>Page refreshed {lastRefresh}</span>}
                  {dataAge && (
                    <span className={`font-medium ${
                      (dataAge.endsWith("m") ? parseInt(dataAge) * 60 : parseInt(dataAge)) > 90
                        ? "text-orange-500" : "text-green-600"
                    }`}>
                      CricAPI data {dataAge} old
                    </span>
                  )}
                  {!detail?.liveState.matchEnded && autoRefresh && (
                    <span className="text-gray-300">· auto-refresh every 20s</span>
                  )}
                </div>

                {/* Win probability — always shown */}
                {wp && (
                  <div className={`rounded-lg p-3 ${wp.isPreMatch ? "bg-yellow-50 border border-yellow-200" : "bg-blue-50 border border-blue-200"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">Win Probability</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        wp.isPreMatch ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800"
                      }`}>
                        {wp.modelVersion}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold mb-1">
                      <span>{wp.teamAName}</span>
                      <span>{wp.teamBName}</span>
                    </div>
                    <div className="flex h-10 rounded-lg overflow-hidden shadow-inner">
                      <div
                        className={`flex items-center justify-center text-white font-bold text-sm transition-all duration-700 ${wp.isPreMatch ? "bg-yellow-500" : "bg-blue-600"}`}
                        style={{ width: `${Math.round((wp.teamAWinProb ?? 0.5) * 100)}%` }}
                      >
                        {Math.round((wp.teamAWinProb ?? 0.5) * 100) >= 15
                          ? `${Math.round((wp.teamAWinProb ?? 0.5) * 100)}%`
                          : ""}
                      </div>
                      <div
                        className={`flex items-center justify-center text-white font-bold text-sm transition-all duration-700 ${wp.isPreMatch ? "bg-orange-400" : "bg-red-500"}`}
                        style={{ width: `${Math.round((wp.teamBWinProb ?? 0.5) * 100)}%` }}
                      >
                        {Math.round((wp.teamBWinProb ?? 0.5) * 100) >= 15
                          ? `${Math.round((wp.teamBWinProb ?? 0.5) * 100)}%`
                          : ""}
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>{Math.round((wp.teamAWinProb ?? 0.5) * 100)}% chance</span>
                      <span>{Math.round((wp.teamBWinProb ?? 0.5) * 100)}% chance</span>
                    </div>
                  </div>
                )}

                {/* Live score */}
                {!detail.liveState.matchEnded && detail.liveState.matchStarted && (
                  <ScoreDisplay state={detail.liveState} teams={detail.teams} />
                )}

                {/* Rollbit odds */}
                {detail.rollbit && (
                  <RollbitPanel
                    rollbit={detail.rollbit}
                    modelProbA={wp?.teamAWinProb ?? null}
                    teamA={detail.teams[0]}
                    teamB={detail.teams[1]}
                  />
                )}

                {/* Match winner */}
                {detail.liveState.matchEnded && detail.liveState.matchWinner && (
                  <div className="bg-green-50 border border-green-200 rounded p-3 text-sm font-medium text-green-800 text-center">
                    Winner: {detail.liveState.matchWinner}
                  </div>
                )}
              </div>

              {/* Scorecard tabs */}
              {detail.scorecard.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex border-b">
                    <button
                      onClick={() => setActiveTab("scorecard")}
                      className={`flex-1 py-2 text-sm font-medium ${activeTab === "scorecard" ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Batting
                    </button>
                    <button
                      onClick={() => setActiveTab("bowling")}
                      className={`flex-1 py-2 text-sm font-medium ${activeTab === "bowling" ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Bowling
                    </button>
                  </div>

                  {detail.scorecard.map((inn) => (
                    <div key={inn.innings} className="border-b last:border-b-0">
                      <div className="px-4 py-2 bg-gray-50 flex justify-between items-center">
                        <span className="text-xs font-semibold text-gray-700">{inn.inningName}</span>
                        <span className="text-xs font-mono font-bold">
                          {inn.totalRuns}/{inn.totalWickets} ({inn.totalOvers} ov)
                        </span>
                      </div>

                      {activeTab === "scorecard" ? (
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-medium text-gray-600">Batter</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">R</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">B</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">4s</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">6s</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">SR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inn.batting.map((b, i) => (
                              <tr key={i} className="border-b hover:bg-gray-50">
                                <td className="px-3 py-1.5">
                                  <div className="font-medium">{b.name}</div>
                                  <div className="text-gray-400 text-xs">{b.dismissal || "not out"}</div>
                                </td>
                                <td className="px-2 py-1.5 text-right font-bold">{b.runs}</td>
                                <td className="px-2 py-1.5 text-right text-gray-600">{b.balls}</td>
                                <td className="px-2 py-1.5 text-right text-gray-600">{b.fours}</td>
                                <td className="px-2 py-1.5 text-right text-gray-600">{b.sixes}</td>
                                <td className="px-2 py-1.5 text-right text-gray-500">{b.strikeRate.toFixed(1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-medium text-gray-600">Bowler</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">O</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">R</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">W</th>
                              <th className="px-2 py-1.5 text-right font-medium text-gray-600">Eco</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inn.bowling.map((b, i) => (
                              <tr key={i} className="border-b hover:bg-gray-50">
                                <td className="px-3 py-1.5 font-medium">{b.name}</td>
                                <td className="px-2 py-1.5 text-right text-gray-600">{b.overs}</td>
                                <td className="px-2 py-1.5 text-right text-gray-600">{b.runs}</td>
                                <td className="px-2 py-1.5 text-right font-bold">{b.wickets}</td>
                                <td className="px-2 py-1.5 text-right text-gray-500">{b.economy.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
