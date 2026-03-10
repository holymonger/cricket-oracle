"use client";

import { useState, useEffect, useCallback, use } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

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
  matchEnded: boolean;
  matchWinner?: string;
}

interface BatsmanCard { name: string; runs: number; balls: number; fours: number; sixes: number; strikeRate: number; dismissal: string }
interface BowlerCard  { name: string; overs: number; runs: number; wickets: number; economy: number; wides: number; noBalls: number }

interface InningsCard {
  innings: number;
  inningName: string;
  totalRuns: number;
  totalWickets: number;
  totalOvers: number;
  batting: BatsmanCard[];
  bowling: BowlerCard[];
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
    note: string | null;
  };
  cache: { scorecardCachedAt: string | null; scorecardExpiresAt: string | null; forceRefreshed: boolean };
  fetchedAt: string;
}

interface EloResult {
  teamAWinProb: number;
  teamBWinProb: number;
  teamAElo: number;
  teamBElo: number;
  teamAMatchCount: number;
  teamBMatchCount: number;
  teamAFound: string;
  teamBFound: string;
  confidence: "high" | "medium" | "low";
}

interface PreMatchStats {
  teamAName: string;
  teamBName: string;
  venue: string | null;
  headToHead: {
    totalMatches: number;
    teamAWins: number;
    teamBWins: number;
    teamAWinPct: number;
    venueMatches: number;
    venueTeamAWins: number;
    venueTeamAWinPct: number;
    recentMatches: Array<{ matchDate: string | null; venue: string | null; winner: "A" | "B" | null; tossWinner: "A" | "B" | null; tossDecision: string | null }>;
  };
  teamAForm: { last10Wins: number; last10Losses: number; last10WinPct: number; avgFirstInningsScore: number; tossWinRate: number };
  teamBForm: { last10Wins: number; last10Losses: number; last10WinPct: number; avgFirstInningsScore: number; tossWinRate: number };
  venueStats: { totalMatches: number; avgFirstInningsScore: number; firstInningsWinPct: number } | null;
  preMatchWinProbA: number;
  dataPoints: number;
  elo: EloResult | null;
}

interface ReportResult {
  ok: boolean;
  report?: string;
  modelProbA?: number;
  keyFactors?: string[];
  error?: string;
}

interface MarketToken { tokenId: string; outcome: string; price?: number }
interface MarketOdds {
  marketId: string;
  question: string;
  tokens: Array<{ tokenId: string; outcome: string; bestBid: number; bestAsk: number; impliedProb: number }>;
}
interface Market {
  id: string;
  question: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  tokens: MarketToken[];
  endDate?: string;
  odds: MarketOdds | null;
}

type Tab = "pre-match" | "live" | "markets";

// ── Sub-components ─────────────────────────────────────────────────────────────

function WinProbBar({ teamA, probA, teamB }: { teamA: string; probA: number; teamB: string }) {
  const pctA = Math.round(probA * 100);
  const pctB = 100 - pctA;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-semibold">
        <span className="text-blue-700">{teamA}</span>
        <span className="text-red-600">{teamB}</span>
      </div>
      <div className="flex h-9 rounded-full overflow-hidden shadow-inner">
        <div
          className="bg-blue-600 flex items-center justify-center text-white text-sm font-bold transition-all duration-700"
          style={{ width: `${pctA}%` }}
        >
          {pctA >= 12 ? `${pctA}%` : ""}
        </div>
        <div
          className="bg-red-500 flex items-center justify-center text-white text-sm font-bold transition-all duration-700"
          style={{ width: `${pctB}%` }}
        >
          {pctB >= 12 ? `${pctB}%` : ""}
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{pctA}% win probability</span>
        <span>{pctB}% win probability</span>
      </div>
    </div>
  );
}

function StatBadge({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

// ── Pre-Match Tab ──────────────────────────────────────────────────────────────

function PreMatchTab({ teams, venue }: { teams: [string, string]; venue: string }) {
  const [stats, setStats] = useState<PreMatchStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  const [report, setReport] = useState<ReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ teamA: teams[0], teamB: teams[1] });
    if (venue) params.set("venue", venue);
    fetch(`/api/pre-match/stats?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setStatsError(d.error);
        else setStats(d as PreMatchStats);
      })
      .catch((e) => setStatsError(e.message))
      .finally(() => setStatsLoading(false));
  }, [teams, venue]);

  async function generateReport() {
    if (!stats) return;
    setReportLoading(true);
    setReport(null);
    try {
      const res = await fetch("/api/reports/pre-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamA: teams[0], teamB: teams[1], venue: venue || undefined, stats }),
      });
      const data = await res.json();
      setReport(res.ok
        ? { ok: true, report: data.report, modelProbA: data.modelProbA, keyFactors: data.keyFactors ?? [] }
        : { ok: false, error: data.error ?? "Report generation failed" }
      );
    } catch (e: any) {
      setReport({ ok: false, error: e.message });
    } finally {
      setReportLoading(false);
    }
  }

  if (statsLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
        {statsError}
      </div>
    );
  }

  if (!stats) return null;

  const h2h = stats.headToHead;
  const noData = h2h.totalMatches === 0 && stats.teamAForm.last10Wins === 0 && stats.teamBForm.last10Wins === 0;

  return (
    <div className="space-y-6">
      {/* Win probability */}
      {noData && !stats.elo ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">
          <p className="font-medium mb-1">Limited historical data</p>
          <p className="text-xs text-amber-600">
            These teams may not yet be in the local database. The AI report below will rely on general cricket knowledge.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          {/* Blended probability */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Pre-match Win Probability
              <span className="ml-2 text-gray-300 font-normal normal-case">
                {stats.elo && stats.dataPoints >= 5
                  ? "Elo + H2H blend"
                  : stats.elo
                  ? "Elo model (limited H2H)"
                  : `H2H only · ${stats.dataPoints} matches`}
              </span>
            </h3>
            <WinProbBar teamA={teams[0]} probA={stats.preMatchWinProbA} teamB={teams[1]} />
          </div>

          {/* Elo detail row */}
          {stats.elo && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Elo Ratings</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  stats.elo.confidence === "high"   ? "bg-green-100 text-green-700" :
                  stats.elo.confidence === "medium" ? "bg-amber-100 text-amber-700" :
                                                      "bg-gray-100 text-gray-500"
                }`}>
                  {stats.elo.confidence} confidence
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xl font-bold text-blue-700">{stats.elo.teamAElo}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{stats.elo.teamAFound}</div>
                  <div className="text-[10px] text-gray-300">{stats.elo.teamAMatchCount} matches</div>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <div className="text-xs text-gray-400 font-medium">Elo prob</div>
                  <div className="text-sm font-bold mt-1">
                    <span className="text-blue-600">{(stats.elo.teamAWinProb * 100).toFixed(1)}%</span>
                    <span className="text-gray-300 mx-1">/</span>
                    <span className="text-red-500">{(stats.elo.teamBWinProb * 100).toFixed(1)}%</span>
                  </div>
                </div>
                <div>
                  <div className="text-xl font-bold text-red-600">{stats.elo.teamBElo}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{stats.elo.teamBFound}</div>
                  <div className="text-[10px] text-gray-300">{stats.elo.teamBMatchCount} matches</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* H2H */}
      {h2h.totalMatches > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-5 py-3 border-b">
            <h3 className="text-sm font-semibold text-gray-700">Head to Head</h3>
          </div>
          <div className="p-5 grid grid-cols-3 gap-4">
            <StatBadge label={`${teams[0]} wins`} value={h2h.teamAWins} sub={`${(h2h.teamAWinPct * 100).toFixed(0)}%`} />
            <StatBadge label="matches played" value={h2h.totalMatches} sub={h2h.venueMatches > 0 ? `${h2h.venueMatches} at this venue` : undefined} />
            <StatBadge label={`${teams[1]} wins`} value={h2h.teamBWins} sub={`${((1 - h2h.teamAWinPct) * 100).toFixed(0)}%`} />
          </div>
          {h2h.recentMatches.length > 0 && (
            <div className="border-t px-5 pb-4">
              <p className="text-xs font-semibold text-gray-400 mt-3 mb-2 uppercase tracking-wider">
                Last {h2h.recentMatches.length} encounters
              </p>
              <div className="space-y-1.5">
                {h2h.recentMatches.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="text-gray-400 w-24 shrink-0">{m.matchDate ?? "—"}</span>
                    <span className="text-gray-500 flex-1 truncate">{m.venue ?? "—"}</span>
                    <span className={`font-semibold shrink-0 ${m.winner === "A" ? "text-blue-600" : "text-red-600"}`}>
                      {m.winner === "A" ? teams[0] : m.winner === "B" ? teams[1] : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Team form */}
      {(stats.teamAForm.last10Wins > 0 || stats.teamBForm.last10Wins > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { form: stats.teamAForm, name: teams[0], accent: "blue" },
            { form: stats.teamBForm, name: teams[1], accent: "red" },
          ].map(({ form, name, accent }) => (
            <div key={name} className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{name}</h3>
              <div className="grid grid-cols-2 gap-3">
                <StatBadge label="last 10 wins" value={form.last10Wins} sub={`${Math.round(form.last10WinPct * 100)}%`} />
                <StatBadge label="avg 1st inn." value={Math.round(form.avgFirstInningsScore)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Venue */}
      {stats.venueStats && stats.venueStats.totalMatches > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Venue — {venue}</h3>
          <div className="grid grid-cols-3 gap-4">
            <StatBadge label="matches played" value={stats.venueStats.totalMatches} />
            <StatBadge label="avg 1st inn score" value={Math.round(stats.venueStats.avgFirstInningsScore)} />
            <StatBadge label="bat first wins" value={`${Math.round(stats.venueStats.firstInningsWinPct * 100)}%`} />
          </div>
        </div>
      )}

      {/* AI Report */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">AI Pre-Match Report</h3>
            <p className="text-[11px] text-gray-400">Claude AI narrative analysis</p>
          </div>
          {!report && !reportLoading && (
            <button
              onClick={generateReport}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition"
            >
              Generate Report
            </button>
          )}
        </div>

        <div className="p-5">
          {reportLoading ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(5)].map((_, i) => (
                <div key={i} className={`h-3 bg-gray-100 rounded ${i === 4 ? "w-2/3" : "w-full"}`} />
              ))}
            </div>
          ) : report?.ok ? (
            <div className="space-y-4">
              {report.modelProbA !== undefined && (
                <div className="flex gap-4 p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <div className="text-center">
                    <div className="text-lg font-bold text-purple-700">{(report.modelProbA * 100).toFixed(1)}%</div>
                    <div className="text-xs text-purple-500">{teams[0]}</div>
                  </div>
                  <div className="text-gray-300 self-center">|</div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-purple-700">{((1 - report.modelProbA) * 100).toFixed(1)}%</div>
                    <div className="text-xs text-purple-500">{teams[1]}</div>
                  </div>
                  <div className="text-[10px] text-purple-400 self-center ml-auto">AI model</div>
                </div>
              )}
              {report.keyFactors && report.keyFactors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {report.keyFactors.map((f, i) => (
                    <span key={i} className="text-[11px] bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed text-sm whitespace-pre-wrap">
                {report.report}
              </div>
            </div>
          ) : report?.error ? (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{report.error}</div>
          ) : (
            <p className="text-sm text-gray-400">
              Click &quot;Generate Report&quot; for an AI-powered narrative covering H2H trends, form, venue conditions, and win probability.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Live Tab ───────────────────────────────────────────────────────────────────

function LiveTab({ matchId, initialDetail }: { matchId: string; initialDetail: MatchDetail }) {
  const [detail, setDetail] = useState<MatchDetail>(initialDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date().toLocaleTimeString());
  const [activeTab, setActiveTab] = useState<"batting" | "bowling">("batting");

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/live/match/${matchId}${force ? "?force=true" : ""}`);
      if (!res.ok) { const d = await res.json(); setError(d.error || "Failed"); return; }
      const d: MatchDetail = await res.json();
      setDetail(d);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    if (!autoRefresh || detail.liveState.matchEnded) return;
    const interval = setInterval(() => load(), 20_000);
    return () => clearInterval(interval);
  }, [autoRefresh, detail.liveState.matchEnded, load]);

  const state = detail.liveState;
  const wp = detail.winProb;
  const battingTeam = state.battingTeamIdx !== null ? detail.teams[state.battingTeamIdx] : "—";
  const overs = `${Math.floor(state.balls / 6)}.${state.balls % 6}`;

  const dataAge = detail.cache.scorecardCachedAt
    ? Math.round((Date.now() - new Date(detail.cache.scorecardCachedAt).getTime()) / 1000)
    : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
          Auto-refresh (20s)
        </label>
        <button onClick={() => load()} disabled={loading} className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg font-medium">
          {loading ? "…" : "↻ Refresh"}
        </button>
        <button onClick={() => load(true)} disabled={loading} className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg font-medium">
          ⚡ Force fresh
        </button>
        <div className="flex-1" />
        {lastRefresh && <span className="text-[10px] text-gray-400">Updated {lastRefresh}</span>}
        {dataAge !== null && (
          <span className={`text-[10px] font-medium ${dataAge > 90 ? "text-orange-500" : "text-green-600"}`}>
            · data {dataAge}s old
          </span>
        )}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>}

      {/* Live score */}
      {!state.matchEnded && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-center">
            <div className="text-xs text-gray-500 mb-1">Batting — {battingTeam}</div>
            <div className="text-3xl font-bold text-blue-800">{state.runs}/{state.wickets}</div>
            <div className="text-sm text-gray-600 mt-1">({overs} ov) · RR {state.runRate.toFixed(2)}</div>
          </div>
          {state.target !== null ? (
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-5 text-center">
              <div className="text-xs text-gray-500 mb-1">Target {state.target}</div>
              <div className="text-3xl font-bold text-orange-700">Need {state.runsNeeded}</div>
              <div className="text-sm text-gray-600 mt-1">
                {state.ballsRemaining} balls · RRR {state.requiredRunRate?.toFixed(2)}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-center">
              <div className="text-xs text-gray-500 mb-1">1st Innings</div>
              <div className="text-3xl font-bold text-gray-700">{20 - Math.floor(state.balls / 6)} ov left</div>
              <div className="text-sm text-gray-600 mt-1">RR {state.runRate.toFixed(2)}</div>
            </div>
          )}
        </div>
      )}

      {/* Win probability */}
      {wp.teamAWinProb !== null ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Live Win Probability · {wp.modelVersion}
          </div>
          <WinProbBar teamA={wp.teamAName} probA={wp.teamAWinProb} teamB={wp.teamBName} />
        </div>
      ) : wp.note ? (
        <div className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-xl p-3">{wp.note}</div>
      ) : null}

      {/* Winner banner */}
      {state.matchEnded && state.matchWinner && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
          <div className="text-xs text-green-600 uppercase tracking-wider mb-1">Match Result</div>
          <div className="text-lg font-bold text-green-800">{state.matchWinner}</div>
        </div>
      )}

      {/* Scorecard */}
      {detail.scorecard.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex border-b">
            {(["batting", "bowling"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex-1 py-2.5 text-sm font-medium capitalize transition ${
                  activeTab === t ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {detail.scorecard.map((inn) => (
            <div key={inn.innings} className="border-b last:border-b-0">
              <div className="px-4 py-2.5 bg-gray-50 flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-700">{inn.inningName}</span>
                <span className="text-xs font-mono font-bold">{inn.totalRuns}/{inn.totalWickets} ({inn.totalOvers} ov)</span>
              </div>

              {activeTab === "batting" ? (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-gray-500">Batter</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">R</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">B</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">4s</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">6s</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">SR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inn.batting.map((b, i) => (
                      <tr key={i} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{b.name}</div>
                          <div className="text-gray-400 text-[10px]">{b.dismissal || "not out"}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold">{b.runs}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{b.balls}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{b.fours}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{b.sixes}</td>
                        <td className="px-2 py-1.5 text-right text-gray-400">{b.strikeRate.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-gray-500">Bowler</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">O</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">R</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">W</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-500">Eco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inn.bowling.map((b, i) => (
                      <tr key={i} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium">{b.name}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{b.overs}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{b.runs}</td>
                        <td className="px-2 py-1.5 text-right font-bold">{b.wickets}</td>
                        <td className="px-2 py-1.5 text-right text-gray-400">{b.economy.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Markets Tab ────────────────────────────────────────────────────────────────

function MarketsTab({ matchId }: { matchId: string }) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [teams, setTeams] = useState<[string, string] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/live/match/${matchId}/markets`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setMarkets(d.markets ?? []);
        setTeams(d.teams ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [matchId]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
      </div>
    );
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">{error}</div>;
  }

  if (markets.length === 0) {
    return (
      <div className="text-center py-16 bg-gray-50 border border-gray-200 border-dashed rounded-2xl">
        <div className="text-4xl mb-3">📊</div>
        <p className="text-gray-500 text-sm font-medium">No Polymarket markets found</p>
        <p className="text-xs text-gray-400 mt-1">
          {teams ? `Searched for: ${teams[0]} · ${teams[1]}` : ""}
        </p>
        <p className="text-xs text-gray-400 mt-1">Markets may open closer to match time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Auto-matched {markets.length} Polymarket market{markets.length !== 1 ? "s" : ""} for {teams?.join(" vs ")}
      </p>
      {markets.map((m) => (
        <div key={m.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <p className="text-sm font-semibold text-gray-800 leading-tight">{m.question}</p>
            <div className="flex gap-4 mt-1.5 text-[10px] text-gray-400">
              {m.volume && <span>Vol ${(m.volume / 1000).toFixed(0)}k</span>}
              {m.volume24hr && <span>24h ${(m.volume24hr / 1000).toFixed(1)}k</span>}
              {m.liquidity && <span>Liq ${(m.liquidity / 1000).toFixed(0)}k</span>}
              {m.endDate && <span>Ends {new Date(m.endDate).toLocaleDateString()}</span>}
            </div>
          </div>
          <div className="px-5 py-3 flex flex-wrap gap-3">
            {(m.odds?.tokens ?? m.tokens).map((token: any) => {
              const prob = m.odds
                ? token.impliedProb
                : (token.price ?? 0.5);
              return (
                <div
                  key={token.tokenId}
                  className="flex-1 min-w-[120px] bg-gray-50 border border-gray-100 rounded-lg p-3 text-center"
                >
                  <div className="text-xs text-gray-500 mb-1 truncate">{token.outcome}</div>
                  <div className={`text-lg font-bold ${prob > 0.6 ? "text-green-600" : prob < 0.4 ? "text-red-600" : "text-gray-800"}`}>
                    {(prob * 100).toFixed(1)}%
                  </div>
                  {m.odds && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {token.bestBid?.toFixed(2)} / {token.bestAsk?.toFixed(2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  useEffect(() => {
    fetch(`/api/live/match/${id}`)
      .then((r) => r.json())
      .then((d: MatchDetail) => {
        if ((d as any).error) { setError((d as any).error); return; }
        setDetail(d);
        // Pick default tab based on match status
        if (!d.liveState.matchEnded && d.liveState.balls >= 6) {
          setActiveTab("live");
        } else if (!d.liveState.matchEnded && d.liveState.balls === 0) {
          setActiveTab("pre-match");
        } else {
          setActiveTab("live"); // ended — show final scorecard
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-bounce">🏏</div>
          <p className="text-gray-400 text-sm">Loading match data…</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-red-200 rounded-2xl p-8 max-w-md text-center">
          <p className="text-red-600 font-medium mb-2">Failed to load match</p>
          <p className="text-sm text-gray-500">{error || "Unknown error"}</p>
          <a href="/" className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Back to matches</a>
        </div>
      </div>
    );
  }

  const isLive = !detail.liveState.matchEnded && detail.liveState.balls > 0;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "pre-match", label: "Pre-Match" },
    { id: "live", label: isLive ? "Live" : "Scorecard" },
    { id: "markets", label: "Markets" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Match header ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-6 py-5">
          {/* Back nav */}
          <a href="/" className="text-xs text-white/40 hover:text-white/70 transition mb-4 inline-block">
            ← All matches
          </a>

          {/* Status badges */}
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border tracking-wider ${
              detail.matchType === "t20"  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
              detail.matchType === "odi"  ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
              "bg-amber-500/20 text-amber-400 border-amber-500/30"
            }`}>
              {detail.matchType.toUpperCase()}
            </span>
            {isLive && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                LIVE
              </span>
            )}
            {detail.liveState.matchEnded && (
              <span className="text-[10px] font-medium text-white/30 tracking-wider">ENDED</span>
            )}
          </div>

          {/* Teams */}
          <h1 className="text-2xl font-bold tracking-tight">
            {detail.teams[0]} <span className="text-white/30 font-normal">vs</span> {detail.teams[1]}
          </h1>
          <p className="text-xs text-white/35 mt-1">{detail.venue}</p>
          <p className="text-sm text-white/50 mt-1">{detail.status}</p>

          {/* Quick score summary if live */}
          {isLive && detail.liveState.scorecard.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.liveState.scorecard.map((s, i) => (
                <span key={i} className="text-[11px] font-mono bg-white/10 text-white/70 px-2.5 py-1 rounded-full">
                  {s.inning.split(" ").slice(-2).join(" ")}: {s.r}/{s.w} ({s.o})
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────────── */}
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex border-t border-white/10">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-6 py-3 text-sm font-medium transition border-b-2 ${
                  activeTab === t.id
                    ? "border-blue-400 text-white"
                    : "border-transparent text-white/40 hover:text-white/70"
                }`}
              >
                {t.label}
                {t.id === "live" && isLive && (
                  <span className="ml-2 w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {activeTab === "pre-match" && (
          <PreMatchTab teams={detail.teams} venue={detail.venue} />
        )}
        {activeTab === "live" && (
          <LiveTab matchId={id} initialDetail={detail} />
        )}
        {activeTab === "markets" && (
          <MarketsTab matchId={id} />
        )}
      </div>
    </div>
  );
}
