"use client";

import { useMemo, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import WinProbChart from "@/components/WinProbChart";

type Result =
  | {
      winProb: number;
      ballsRemaining: number;
      runsRemaining?: number;
      reqRr?: number;
      curRr?: number;
    }
  | { error: string; details?: unknown };

type StatementResult =
  | {
      ok: true;
      template: unknown;
      probability: number;
      explanation: string;
      modelVersion: string;
    }
  | {
      ok: false;
      template?: unknown;
      error: string;
      missing?: string[];
      supportedExamples?: string[];
    };

type MatchSnapshot = {
  matchId: string;
  timestamp: number;
  state: any;
};

const EXAMPLE_STATEMENTS = [
  "1st innings powerplay over 49.5",
  "2nd innings 0-10 under 78.5",
  "Team A over 170.5",
  "Team A 180+",
  "Match total over 329.5",
];

export default function MatchPage() {
  const router = useRouter();
  const pathname = usePathname();

  // Match creation
  const [teamA, setTeamA] = useState<string>("Team A");
  const [teamB, setTeamB] = useState<string>("Team B");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchCreating, setMatchCreating] = useState(false);

  // Match snapshots
  const [snapshots, setSnapshots] = useState<Array<{ snapshot: MatchSnapshot; winProb: number }>>([]);
  const [snapshotSaving, setSnapshotSaving] = useState(false);

  // Match state
  const [innings, setInnings] = useState<1 | 2>(2);
  const [runs, setRuns] = useState(75);
  const [wickets, setWickets] = useState(2);
  const [balls, setBalls] = useState(54); // 9.0 overs
  const [targetRuns, setTargetRuns] = useState<number>(160);
  const [runsAfter6, setRunsAfter6] = useState<number | null>(null);
  const [runsAfter10, setRunsAfter10] = useState<number | null>(null);
  const [runsAfter12, setRunsAfter12] = useState<number | null>(null);
  const [teamFours, setTeamFours] = useState<number | null>(null);
  const [teamSixes, setTeamSixes] = useState<number | null>(null);
  const [matchFours, setMatchFours] = useState<number | null>(null);
  const [matchSixes, setMatchSixes] = useState<number | null>(null);

  const [statementText, setStatementText] = useState("");
  const [statementResult, setStatementResult] = useState<StatementResult | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  // Load extracted data from query params after applying from upload page
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    const reads: Array<["runs" | "wickets" | "balls" | "targetRuns", (value: number) => void]> = [
      ["runs", setRuns],
      ["wickets", setWickets],
      ["balls", setBalls],
      ["targetRuns", setTargetRuns],
    ];

    let appliedAny = false;
    for (const [key, setter] of reads) {
      const raw = searchParams.get(key);
      if (raw === null) {
        continue;
      }
      const value = Number(raw);
      if (Number.isFinite(value)) {
        setter(value);
        appliedAny = true;
      }
    }

    if (appliedAny) {
      const cleaned = new URLSearchParams(window.location.search);
      cleaned.delete("runs");
      cleaned.delete("wickets");
      cleaned.delete("balls");
      cleaned.delete("targetRuns");
      const query = cleaned.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }, [pathname, router]);

  const payload = useMemo(() => {
    return {
      innings,
      runs,
      wickets,
      balls,
      targetRuns: innings === 2 ? targetRuns : null,
    };
  }, [innings, runs, wickets, balls, targetRuns]);

  const payloadWithOptionals = useMemo(() => {
    return {
      ...payload,
      runsAfter6: runsAfter6 ?? null,
      runsAfter10: runsAfter10 ?? null,
      runsAfter12: runsAfter12 ?? null,
      teamFours: teamFours ?? null,
      teamSixes: teamSixes ?? null,
      matchFours: matchFours ?? null,
      matchSixes: matchSixes ?? null,
    };
  }, [payload, runsAfter6, runsAfter10, runsAfter12, teamFours, teamSixes, matchFours, matchSixes]);

  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function createMatch() {
    setMatchCreating(true);
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamA, teamB }),
      });
      const data = await res.json();
      if (data.matchId) {
        setMatchId(data.matchId);
        setSnapshots([]);
      }
    } catch (e) {
      console.error("Failed to create match", e);
    } finally {
      setMatchCreating(false);
    }
  }

  async function saveSnapshot() {
    if (!matchId) return;
    setSnapshotSaving(true);
    try {
      const res = await fetch(`/api/matches/${matchId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: payloadWithOptionals }),
      });
      const data = await res.json();
      if (data.snapshot) {
        setSnapshots([...snapshots, { snapshot: data.snapshot, winProb: data.winProb }]);
      }
    } catch (e) {
      console.error("Failed to save snapshot", e);
    } finally {
      setSnapshotSaving(false);
    }
  }

  async function loadSnapshots() {
    if (!matchId) return;
    try {
      const res = await fetch(`/api/matches/${matchId}/snapshots`);
      const data = await res.json();
      if (data.snapshots) {
        // Re-compute winProbs for display
        const withWinProbs = data.snapshots.map((snap: MatchSnapshot, idx: number) => ({
          snapshot: snap,
          winProb: snapshots[idx]?.winProb ?? 0.5,
        }));
        setSnapshots(withWinProbs);
      }
    } catch (e) {
      console.error("Failed to load snapshots", e);
    }
  }

  async function compute() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/winprob", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ error: "Request failed", details: String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function computeStatement() {
    setStatementLoading(true);
    setStatementResult(null);

    try {
      const res = await fetch("/api/statement-prob", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statementText, state: payloadWithOptionals }),
      });

      const data = await res.json();
      setStatementResult(data);
    } catch (e) {
      setStatementResult({ ok: false, error: "Request failed", template: { error: String(e) } });
    } finally {
      setStatementLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-semibold">Cricket Oracle (v0)</h1>
        <a
          href="/match/upload"
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-medium transition"
        >
          📸 Upload Scorecard
        </a>
      </div>

      {/* Match Creation Section */}
      <div className="space-y-4 border-b pb-6">
        <h2 className="text-xl font-semibold">1. Create or Load Match</h2>
        {!matchId ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Create a new match to track snapshots</p>
            <div className="grid grid-cols-2 gap-3">
              <input
                className="border rounded p-2"
                placeholder="Team A"
                value={teamA}
                onChange={(e) => setTeamA(e.target.value)}
                disabled={matchCreating}
              />
              <input
                className="border rounded p-2"
                placeholder="Team B"
                value={teamB}
                onChange={(e) => setTeamB(e.target.value)}
                disabled={matchCreating}
              />
            </div>
            <button
              onClick={createMatch}
              disabled={matchCreating || !teamA.trim() || !teamB.trim()}
              className="bg-purple-600 text-white rounded px-4 py-2 disabled:opacity-60"
            >
              {matchCreating ? "Creating..." : "Create Match"}
            </button>
          </div>
        ) : (
          <div className="bg-purple-50 border border-purple-200 rounded p-4">
            <div className="text-sm">
              <div>
                <span className="font-semibold">Match ID:</span> {matchId}
              </div>
              <div>
                <span className="font-semibold">Teams:</span> {teamA} vs {teamB}
              </div>
              <div>
                <span className="font-semibold">Snapshots saved:</span> {snapshots.length}
              </div>
            </div>
            <button
              onClick={() => {
                setMatchId(null);
                setSnapshots([]);
              }}
              className="mt-3 text-sm text-purple-600 hover:underline"
            >
              Create new match
            </button>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Match State</h2>
        
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <div className="text-sm">Innings</div>
            <select
              className="w-full border rounded p-2"
              value={innings}
              onChange={(e) => setInnings(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>1st innings</option>
              <option value={2}>2nd innings</option>
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-sm">Target (only innings 2)</div>
            <input
              className="w-full border rounded p-2"
              type="number"
              value={targetRuns}
              disabled={innings !== 2}
              onChange={(e) => setTargetRuns(Number(e.target.value))}
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm">Runs</div>
            <input
              className="w-full border rounded p-2"
              type="number"
              value={runs}
              onChange={(e) => setRuns(Number(e.target.value))}
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm">Wickets</div>
            <input
              className="w-full border rounded p-2"
              type="number"
              value={wickets}
              onChange={(e) => setWickets(Number(e.target.value))}
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm">Balls bowled (0–120)</div>
            <input
              className="w-full border rounded p-2"
              type="number"
              value={balls}
              onChange={(e) => setBalls(Number(e.target.value))}
            />
          </label>
        </div>

        {/* Optional Checkpoints */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold mb-2">Optional Checkpoints (for segment markets)</h3>
          <div className="grid grid-cols-3 gap-4">
            <label className="space-y-1">
              <div className="text-xs">Runs after 6 overs</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={runsAfter6 ?? ""}
                onChange={(e) => setRunsAfter6(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs">Runs after 10 overs</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={runsAfter10 ?? ""}
                onChange={(e) => setRunsAfter10(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs">Runs after 12 overs</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={runsAfter12 ?? ""}
                onChange={(e) => setRunsAfter12(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
          </div>

          {/* Boundary Counts */}
          <div className="grid grid-cols-4 gap-4 mt-4">
            <label className="space-y-1">
              <div className="text-xs">Team Fours</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={teamFours ?? ""}
                onChange={(e) => setTeamFours(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs">Team Sixes</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={teamSixes ?? ""}
                onChange={(e) => setTeamSixes(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs">Match Fours</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={matchFours ?? ""}
                onChange={(e) => setMatchFours(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs">Match Sixes</div>
              <input
                className="w-full border rounded p-2 text-sm"
                type="number"
                placeholder="—"
                value={matchSixes ?? ""}
                onChange={(e) => setMatchSixes(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Win Probability Section */}
      <div className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-semibold">2. Win Probability & Snapshots</h2>
        {!matchId && <p className="text-sm text-orange-600">💡 Hint: Create a match first (in section 1) to enable snapshot saving</p>}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={compute}
            disabled={loading}
            className="bg-black text-white rounded px-4 py-2 disabled:opacity-60"
          >
            {loading ? "Computing..." : "Compute win probability"}
          </button>

          <button
            onClick={saveSnapshot}
            disabled={!matchId || snapshotSaving}
            title={!matchId ? "Create a match first" : ""}
            className="bg-teal-600 text-white rounded px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {snapshotSaving ? "Saving..." : "💾 Save snapshot"}
          </button>
        </div>

        <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">
Payload: {JSON.stringify(payload, null, 2)}
        </pre>

        {result && (
          <div className="border rounded p-4 space-y-2">
            {"error" in result ? (
              <>
                <div className="text-red-600 font-medium">{result.error}</div>
                {"details" in result && (
                  <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">
{JSON.stringify(result.details, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <>
                <div className="text-lg">
                  Win probability: <b>{(result.winProb * 100).toFixed(1)}%</b>
                </div>
                {typeof result.runsRemaining === "number" && (
                  <div>Runs remaining: {result.runsRemaining}</div>
                )}
                {typeof result.reqRr === "number" && (
                  <div>Required RR: {result.reqRr.toFixed(2)}</div>
                )}
                {typeof result.curRr === "number" && (
                  <div>Current RR: {result.curRr.toFixed(2)}</div>
                )}
                <div>Balls remaining: {result.ballsRemaining}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Custom Statement Section */}
      <div className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-semibold">Custom Statement</h2>
        
        <label className="space-y-2">
          <div className="text-sm">Enter a statement (e.g., "Team A over 170.5")</div>
          <input
            className="w-full border rounded p-3"
            type="text"
            placeholder="e.g. Match total over 329.5"
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
          />
        </label>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Quick examples (click to fill):</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_STATEMENTS.map((ex) => (
              <button
                key={ex}
                onClick={() => setStatementText(ex)}
                className="px-3 py-1 bg-blue-100 text-blue-900 rounded text-sm hover:bg-blue-200"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={computeStatement}
          disabled={statementLoading || !statementText.trim()}
          className="bg-green-600 text-white rounded px-4 py-2 disabled:opacity-60"
        >
          {statementLoading ? "Computing..." : "Compute statement probability"}
        </button>

        <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">
State: {JSON.stringify(payloadWithOptionals, null, 2)}
        </pre>

        {statementResult && (
          <div className="border rounded p-4 space-y-2">
            {!statementResult.ok ? (
              <>
                <div className="text-red-600 font-medium">{statementResult.error}</div>
                {statementResult.missing && (
                  <div className="text-sm">
                    Missing fields: <b>{statementResult.missing.join(", ")}</b>
                  </div>
                )}
                {statementResult.supportedExamples && (
                  <div className="text-sm">
                    <div className="font-semibold">Supported examples:</div>
                    <ul className="list-disc list-inside">
                      {statementResult.supportedExamples.map((ex, i) => (
                        <li key={i}>{ex}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-lg">
                  Probability: <b>{(statementResult.probability * 100).toFixed(1)}%</b>
                </div>
                <div className="text-sm text-gray-700">{statementResult.explanation}</div>
                <div className="text-xs text-gray-500">Model version: {statementResult.modelVersion}</div>
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold">View full response</summary>
                  <pre className="bg-gray-50 border rounded p-2 mt-2 overflow-auto">
{JSON.stringify(statementResult, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </div>
        )}
      </div>

      {/* Timeline Section */}
      {matchId && snapshots.length > 0 && (
        <div className="space-y-4 border-t pt-6">
          <h2 className="text-xl font-semibold">3. Snapshots Timeline</h2>
          
          {/* Chart */}
          <WinProbChart
            snapshots={snapshots.map((item) => ({
              timestamp: item.snapshot.timestamp,
              winProb: item.winProb,
            }))}
          />

          {/* List */}
          <div className="space-y-2 border rounded p-4 bg-gray-50">
            {snapshots.map((item, idx) => {
              const snap = item.snapshot;
              const overs = Math.floor(snap.state.balls / 6);
              const balls = snap.state.balls % 6;
              const time = new Date(snap.timestamp).toLocaleTimeString();
              return (
                <div
                  key={idx}
                  className="border rounded p-3 bg-white flex justify-between items-start"
                >
                  <div className="flex-1 space-y-1">
                    <div className="text-sm font-semibold">Snapshot {idx + 1}</div>
                    <div className="text-xs text-gray-600">{time}</div>
                    <div className="text-xs">
                      <span className="font-semibold">{snap.state.runs}/{snap.state.wickets}</span> ({overs}.{balls})
                      {snap.state.targetRuns && (
                        <span className="ml-2">
                          Target: <span className="font-semibold">{snap.state.targetRuns}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-teal-600">
                      {(item.winProb * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500">win prob</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
