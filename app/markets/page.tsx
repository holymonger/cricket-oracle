"use client";

import { useState, useEffect } from "react";

interface EdgeSignal {
  id: string;
  matchId: string;
  market: string;
  teamA: string;
  teamB: string;
  observedAt: string;
  oddsA: number;
  oddsB: number;
  marketProbA: number;
  teamAWinProb: number;
  edgeA: number;
  overround: number;
  notes?: string;
  isStale: boolean;
}

export default function MarketsPage() {
  const [adminKey, setAdminKey] = useState<string>("");
  const [adminKeyInput, setAdminKeyInput] = useState<string>("");
  const [edgeThreshold, setEdgeThreshold] = useState<number>(0.03);
  const [signals, setSignals] = useState<EdgeSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedMatch, setSelectedMatch] = useState<string>("");
  const [pollStatus, setPollStatus] = useState<string>("");

  // Load admin key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("cricket_oracle_admin_key");
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

  // Load edge signals
  async function loadSignals() {
    if (!adminKey) {
      setError("Admin key required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/markets/signals", {
        method: "GET",
        headers: {
          "x-admin-key": adminKey,
        },
      });

      if (res.status === 401) {
        setError("Unauthorized - invalid admin key");
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load signals");
        return;
      }

      const data = await res.json();
      setSignals(data.signals || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Poll odds for a match
  async function pollMatch() {
    if (!adminKey) {
      setPollStatus("⚠️ Admin key required");
      return;
    }

    if (!selectedMatch) {
      setPollStatus("⚠️ Select a match first");
      return;
    }

    setPollStatus("⏳ Polling...");

    try {
      const res = await fetch("/api/markets/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          matchId: selectedMatch,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setPollStatus(`❌ Error: ${data.message || data.error}`);
        return;
      }

      const data = await res.json();
      setPollStatus(
        `✓ Processed ${data.edgeSignals?.length || 0} edge signals`
      );

      // Reload signals
      await loadSignals();
    } catch (err: any) {
      setPollStatus(`❌ ${err.message}`);
    }
  }

  // Filter signals by edge threshold
  const filteredSignals = signals.filter(
    (s) => Math.abs(s.edgeA) >= edgeThreshold
  );

  // Sort by absolute edge (largest first)
  const sortedSignals = [...filteredSignals].sort(
    (a, b) => Math.abs(b.edgeA) - Math.abs(a.edgeA)
  );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-semibold">Edge Signals</h1>
        <a
          href="/match"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium transition"
        >
          ← Back to Match
        </a>
      </div>

      {/* Admin Key Section */}
      <div className="bg-blue-50 border border-blue-200 rounded p-4 space-y-3">
        <h3 className="font-semibold text-blue-900">🔑 Admin Key</h3>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="Enter admin key..."
            value={adminKeyInput}
            onChange={(e) => setAdminKeyInput(e.target.value)}
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              if (adminKeyInput.trim()) {
                setAdminKey(adminKeyInput);
                localStorage.setItem("cricket_oracle_admin_key", adminKeyInput);
                setAdminKeyInput("");
              }
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Save
          </button>
          <button
            onClick={() => {
              setAdminKey("");
              setAdminKeyInput("");
              localStorage.removeItem("cricket_oracle_admin_key");
            }}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Polling Section */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-purple-900">📊 Poll Odds</h3>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Match ID"
            value={selectedMatch}
            onChange={(e) => setSelectedMatch(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={pollMatch}
            disabled={!adminKey || !selectedMatch}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Poll Now
          </button>
        </div>
        {pollStatus && (
          <div className="bg-white border border-gray-300 rounded px-3 py-2 text-sm font-mono">
            {pollStatus}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
        <h3 className="font-semibold">Filters</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Min Edge Threshold
            </label>
            <input
              type="number"
              step="0.01"
              value={edgeThreshold}
              onChange={(e) => setEdgeThreshold(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={loadSignals}
              disabled={!adminKey || loading}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-2 rounded text-sm font-medium w-full"
            >
              {loading ? "Loading..." : "Load Signals"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-300 rounded p-3 text-red-700">
          {error}
        </div>
      )}

      {/* Signals Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="font-semibold">
            Edge Signals ({sortedSignals.length} / {signals.length} total)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-2 text-left">Match</th>
                <th className="px-4 py-2 text-left">Market</th>
                <th className="px-4 py-2 text-right">Odds A</th>
                <th className="px-4 py-2 text-right">Odds B</th>
                <th className="px-4 py-2 text-right">Fair P(A)</th>
                <th className="px-4 py-2 text-right">Model P(A)</th>
                <th className="px-4 py-2 text-right">Edge</th>
                <th className="px-4 py-2 text-right">Overround</th>
                <th className="px-4 py-2 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {sortedSignals.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    {loading
                      ? "Loading..."
                      : signals.length === 0
                      ? "No signals found. Poll a match to get started."
                      : "No signals meet threshold criteria."}
                  </td>
                </tr>
              ) : (
                sortedSignals.map((signal) => (
                  <tr
                    key={signal.id}
                    className={`border-b hover:bg-gray-50 ${
                      signal.isStale ? "bg-yellow-50" : ""
                    }`}
                  >
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs">{signal.matchId.slice(0, 8)}...</div>
                      <div className="text-xs text-gray-600">
                        {signal.teamA} vs {signal.teamB}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-medium">{signal.market}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {signal.oddsA.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {signal.oddsB.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {(signal.marketProbA * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {(signal.teamAWinProb * 100).toFixed(1)}%
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono font-bold ${
                        signal.edgeA > 0
                          ? "text-green-600"
                          : signal.edgeA < 0
                          ? "text-red-600"
                          : "text-gray-600"
                      }`}
                    >
                      {signal.edgeA > 0 ? "+" : ""}
                      {(signal.edgeA * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {((signal.overround - 1) * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-xs">
                        {new Date(signal.observedAt).toLocaleTimeString()}
                      </div>
                      {signal.isStale && (
                        <div className="text-xs text-yellow-600">⚠️ Stale</div>
                      )}
                      {signal.notes && (
                        <div className="text-xs text-gray-500">{signal.notes}</div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm">
        <h4 className="font-semibold mb-2">Legend</h4>
        <ul className="space-y-1 text-gray-700">
          <li>
            <span className="font-semibold">Edge</span> = Model P(A) - Market Fair P(A)
          </li>
          <li>
            <span className="text-green-600 font-bold">+Edge</span> = Model favors Team A
            (potential value on Team A)
          </li>
          <li>
            <span className="text-red-600 font-bold">-Edge</span> = Market favors Team A
            (potential value on Team B)
          </li>
          <li>
            <span className="text-yellow-600">⚠️ Stale</span> = Prediction more than 10s
            older than odds
          </li>
          <li>
            <span className="font-semibold">Overround</span> = Bookmaker margin (vig)
          </li>
        </ul>
      </div>
    </div>
  );
}
