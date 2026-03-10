"use client";

import { useState, useEffect, useRef } from "react";
import type { PreMatchStats } from "@/lib/cricket/preMatchStats";

type ReportResult =
  | { ok: true; report: string; modelProbA: number; keyFactors: string[] }
  | { ok: false; error: string };

function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // Sync query when value changes externally
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  function select(opt: string) {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        className="w-full border rounded px-3 py-2 text-sm disabled:opacity-50"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border rounded shadow-lg max-h-56 overflow-y-auto text-sm">
          {filtered.map((opt) => (
            <li
              key={opt}
              className="px-3 py-2 hover:bg-purple-50 cursor-pointer truncate"
              onMouseDown={() => select(opt)}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PreMatchPage() {
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [venue, setVenue] = useState("");

  const [teams, setTeams] = useState<string[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [stats, setStats] = useState<PreMatchStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  const [report, setReport] = useState<ReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Load team + venue lists on mount
  useEffect(() => {
    fetch("/api/pre-match/teams")
      .then((r) => r.json())
      .then((d) => {
        setTeams(d.teams ?? []);
        setVenues(d.venues ?? []);
      })
      .catch(() => {})
      .finally(() => setTeamsLoading(false));
  }, []);

  async function loadStats() {
    if (!teamA.trim() || !teamB.trim()) return;
    setStatsLoading(true);
    setStatsError("");
    setStats(null);
    setReport(null);
    try {
      const params = new URLSearchParams({ teamA, teamB });
      if (venue.trim()) params.set("venue", venue.trim());
      const res = await fetch(`/api/pre-match/stats?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setStatsError(data.error ?? "Failed to load stats");
      } else {
        setStats(data as PreMatchStats);
      }
    } catch (e: any) {
      setStatsError(e.message);
    } finally {
      setStatsLoading(false);
    }
  }

  async function generateReport() {
    if (!stats) return;
    setReportLoading(true);
    setReport(null);
    try {
      const res = await fetch("/api/reports/pre-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamA, teamB, venue: venue || undefined, stats }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReport({ ok: false, error: data.error ?? "Report generation failed" });
      } else {
        setReport({ ok: true, report: data.report, modelProbA: data.modelProbA, keyFactors: data.keyFactors ?? [] });
      }
    } catch (e: any) {
      setReport({ ok: false, error: e.message });
    } finally {
      setReportLoading(false);
    }
  }

  // Teams available to pick for B = all teams except what A picked
  const teamsForA = teamB ? teams.filter((t) => t !== teamB) : teams;
  const teamsForB = teamA ? teams.filter((t) => t !== teamA) : teams;

  const h2h = stats?.headToHead;
  const fmA = stats?.teamAForm;
  const fmB = stats?.teamBForm;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-semibold">Pre-Match Oracle</h1>
        <a href="/match" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
          ← Live Match
        </a>
      </div>

      {/* Input */}
      <div className="bg-gray-50 border rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-lg">Match Setup</h2>
        {teamsLoading ? (
          <div className="text-sm text-gray-500">Loading teams…</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Combobox
              label="Team A"
              value={teamA}
              onChange={setTeamA}
              options={teamsForA}
              placeholder="Search team…"
            />
            <Combobox
              label="Team B"
              value={teamB}
              onChange={setTeamB}
              options={teamsForB}
              placeholder="Search team…"
            />
            <Combobox
              label="Venue (optional)"
              value={venue}
              onChange={setVenue}
              options={venues}
              placeholder="Search venue…"
            />
          </div>
        )}
        <button
          onClick={loadStats}
          disabled={statsLoading || !teamA.trim() || !teamB.trim() || teamsLoading}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2 rounded text-sm font-medium"
        >
          {statsLoading ? "Loading…" : "Analyse Match"}
        </button>
        {statsError && <div className="text-red-600 text-sm">{statsError}</div>}
      </div>

      {/* Stats panels */}
      {stats && (
        <>
          {/* Win prob banner */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-600 text-white rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{(stats.preMatchWinProbA * 100).toFixed(1)}%</div>
              <div className="text-sm opacity-80">{teamA} win prob</div>
            </div>
            <div className="bg-gray-700 text-white rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{stats.dataPoints}</div>
              <div className="text-sm opacity-80">H2H matches found</div>
            </div>
            <div className="bg-red-600 text-white rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{((1 - stats.preMatchWinProbA) * 100).toFixed(1)}%</div>
              <div className="text-sm opacity-80">{teamB} win prob</div>
            </div>
          </div>

          {/* H2H */}
          {h2h && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 font-semibold text-sm">Head to Head</div>
              <div className="p-4 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-blue-600">{h2h.teamAWins}</div>
                  <div className="text-xs text-gray-500">{teamA} wins</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{h2h.totalMatches} played</div>
                  {h2h.venueMatches > 0 && (
                    <div className="text-xs text-gray-500">{h2h.venueMatches} at this venue</div>
                  )}
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{h2h.teamBWins}</div>
                  <div className="text-xs text-gray-500">{teamB} wins</div>
                </div>
              </div>

              {h2h.recentMatches.length > 0 && (
                <div className="border-t px-4 pb-4">
                  <div className="text-xs font-semibold text-gray-500 mb-2 mt-3">Last {h2h.recentMatches.length} encounters</div>
                  <div className="space-y-1">
                    {h2h.recentMatches.map((m, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <span className="text-gray-400 w-24">{m.matchDate ?? "—"}</span>
                        <span className="text-gray-500 flex-1 truncate">{m.venue ?? "—"}</span>
                        <span className={`font-semibold ${m.winner === "A" ? "text-blue-600" : "text-red-600"}`}>
                          {m.winner === "A" ? teamA : m.winner === "B" ? teamB : "—"} won
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Team form */}
          {fmA && fmB && (
            <div className="grid grid-cols-2 gap-4">
              {[
                { form: fmA, name: teamA, colorClass: "bg-blue-50" },
                { form: fmB, name: teamB, colorClass: "bg-red-50" },
              ].map(({ form, name, colorClass }) => (
                <div key={name} className="border rounded-lg overflow-hidden">
                  <div className={`${colorClass} border-b px-4 py-2 font-semibold text-sm`}>{name} — Recent Form</div>
                  <div className="p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Last 10 win rate</span>
                      <span className="font-mono font-semibold">{(form.last10WinPct * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">W / L</span>
                      <span className="font-mono">{form.last10Wins} / {form.last10Losses}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg 1st innings score</span>
                      <span className="font-mono">{form.avgFirstInningsScore.toFixed(0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Toss win rate</span>
                      <span className="font-mono">{(form.tossWinRate * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Bat first when win toss</span>
                      <span className="font-mono">{(form.tossBatFirstRate * 100).toFixed(0)}%</span>
                    </div>
                    {form.venueAvgScore != null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Avg score at venue</span>
                        <span className="font-mono">{form.venueAvgScore.toFixed(0)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Venue stats */}
          {stats.venueStats && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 font-semibold text-sm">Venue: {stats.venueStats.venue}</div>
              <div className="p-4 grid grid-cols-3 gap-4 text-sm text-center">
                <div>
                  <div className="font-bold text-lg">{stats.venueStats.avgFirstInningsScore.toFixed(0)}</div>
                  <div className="text-gray-500 text-xs">Avg 1st innings</div>
                </div>
                <div>
                  <div className="font-bold text-lg">{stats.venueStats.avgSecondInningsScore.toFixed(0)}</div>
                  <div className="text-gray-500 text-xs">Avg 2nd innings</div>
                </div>
                <div>
                  <div className="font-bold text-lg">{(stats.venueStats.firstInningsWinPct * 100).toFixed(0)}%</div>
                  <div className="text-gray-500 text-xs">Batting 1st wins</div>
                </div>
              </div>
            </div>
          )}

          {/* AI Report */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold">AI Pre-Match Report</h3>
              <button
                onClick={generateReport}
                disabled={reportLoading}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium"
              >
                {reportLoading ? "Generating…" : "Generate AI Report"}
              </button>
            </div>

            <div className="p-4">
              {!report && !reportLoading && (
                <p className="text-sm text-gray-500">
                  Click "Generate AI Report" for a detailed narrative analysis powered by Claude.
                </p>
              )}
              {reportLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                  Analysing match data with Claude…
                </div>
              )}
              {report && !report.ok && (
                <div className="text-red-600 text-sm">{report.error}</div>
              )}
              {report && report.ok && (
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="bg-blue-50 border border-blue-200 rounded px-4 py-2 text-center">
                      <div className="text-xl font-bold text-blue-700">{(report.modelProbA * 100).toFixed(1)}%</div>
                      <div className="text-xs text-blue-600">{teamA} AI estimate</div>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded px-4 py-2 text-center">
                      <div className="text-xl font-bold text-red-700">{((1 - report.modelProbA) * 100).toFixed(1)}%</div>
                      <div className="text-xs text-red-600">{teamB} AI estimate</div>
                    </div>
                  </div>

                  {report.keyFactors.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-1">KEY FACTORS</div>
                      <ul className="space-y-1">
                        {report.keyFactors.map((f, i) => (
                          <li key={i} className="text-sm flex gap-2">
                            <span className="text-purple-500 mt-0.5">▸</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans leading-relaxed bg-gray-50 rounded p-4">
                      {report.report}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
