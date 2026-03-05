"use client";

import { useState, useEffect, useRef } from "react";

interface TickData {
  ok: boolean;
  matchId: string;
  timestamp: string;
  prediction?: {
    innings: number;
    legalBallNumber: number | null;
    teamAWinProb: number;
    createdAt: string;
  };
  edge?: {
    marketName: string;
    observedAt: string;
    marketProbA_fair: number;
    marketProbA_raw: number;
    overround: number;
    edgeA: number;
  };
  staleness?: {
    stale: boolean;
    secondsDiff: number;
    warning?: string;
  };
}

export default function RealtimePage() {
  const [adminKey, setAdminKey] = useState<string>("");
  const [adminKeyInput, setAdminKeyInput] = useState<string>("");
  const [matchId, setMatchId] = useState<string>(
    "cmmc4dc4p00002v09lszovaw5"
  );
  const [provider, setProvider] = useState<string>("cricsheet-replay");
  const [edgeThreshold, setEdgeThreshold] = useState<number>(0.03);
  const [autoTicking, setAutoTicking] = useState<boolean>(false);
  const [tickLoading, setTickLoading] = useState<boolean>(false);
  const [lastTick, setLastTick] = useState<TickData | null>(null);
  const [tickCount, setTickCount] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const autoTickRef = useRef<NodeJS.Timeout | null>(null);

  // Load admin key from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("cricket_oracle_admin_key");
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

  // Auto-tick loop
  useEffect(() => {
    if (autoTicking && adminKey && matchId) {
      autoTickRef.current = setInterval(() => {
        runTick();
      }, 1500); // 1.5 seconds

      return () => {
        if (autoTickRef.current) clearInterval(autoTickRef.current);
      };
    }

    return () => {
      if (autoTickRef.current) clearInterval(autoTickRef.current);
    };
  }, [autoTicking, adminKey, matchId]);

  const handleSetAdminKey = () => {
    setAdminKey(adminKeyInput);
    localStorage.setItem("cricket_oracle_admin_key", adminKeyInput);
    setAdminKeyInput("");
  };

  const runTick = async () => {
    if (!adminKey || !matchId) {
      setError("Admin key and match ID required");
      return;
    }

    setTickLoading(true);
    setError("");

    try {
      const response = await fetch("/api/realtime/tick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          matchId,
          provider,
        }),
      });

      if (response.status === 401) {
        setError("Unauthorized - invalid admin key");
        setAdminKey("");
        setAutoTicking(false);
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Tick failed");
        return;
      }

      const data = await response.json();
      setLastTick(data);
      setTickCount((c) => c + 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTickLoading(false);
    }
  };

  const isOpportunity =
    lastTick?.edge &&
    Math.abs(lastTick.edge.edgeA) >= edgeThreshold &&
    lastTick.staleness &&
    !lastTick.staleness.stale;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-4xl font-bold">🏏 Realtime Tick Loop</h1>

      {/* Admin Key Setup */}
      <div className="bg-blue-50 border border-blue-300 rounded p-4">
        {!adminKey ? (
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Admin Key</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={adminKeyInput}
                onChange={(e) => setAdminKeyInput(e.target.value)}
                placeholder="Enter admin key"
                className="flex-1 px-3 py-2 border border-gray-300 rounded"
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSetAdminKey();
                }}
              />
              <button
                onClick={handleSetAdminKey}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Set
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center">
            <span className="text-green-700 font-semibold">
              ✓ Admin key configured
            </span>
            <button
              onClick={() => {
                setAdminKey("");
                localStorage.removeItem("cricket_oracle_admin_key");
              }}
              className="text-sm text-red-600 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Configuration */}
      <div className="bg-gray-50 border border-gray-300 rounded p-4 space-y-4">
        <h2 className="text-xl font-semibold">Configuration</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Match ID</label>
            <input
              type="text"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              placeholder="Match ID"
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              <option value="cricsheet-replay">Cricsheet Replay</option>
              <option value="live-feed">Live Feed (stub)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Edge Threshold
            </label>
            <input
              type="number"
              value={edgeThreshold}
              onChange={(e) => setEdgeThreshold(parseFloat(e.target.value))}
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Ticks: {tickCount}
            </label>
            <div className="text-gray-600 text-sm">Updates so far</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button
          onClick={runTick}
          disabled={!adminKey || tickLoading}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          {tickLoading ? "⏳ Ticking..." : "✓ Tick Once"}
        </button>

        <button
          onClick={() => setAutoTicking(!autoTicking)}
          disabled={!adminKey}
          className={`px-4 py-2 text-white rounded ${
            autoTicking
              ? "bg-red-600 hover:bg-red-700"
              : "bg-purple-600 hover:bg-purple-700"
          } disabled:bg-gray-400`}
        >
          {autoTicking ? "⏸ Stop Auto" : "▶ Auto Tick (1.5s)"}
        </button>

        <button
          onClick={() => {
            setTickCount(0);
            setLastTick(null);
          }}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Reset
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          ⚠️ {error}
        </div>
      )}

      {/* Last Tick Results */}
      {lastTick && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Latest Tick</h2>

          {/* Prediction Card */}
          {lastTick.prediction && (
            <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
              <h3 className="font-semibold mb-2">📊 Ball Prediction</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Innings:</span>{" "}
                  <span className="font-semibold">{lastTick.prediction.innings}</span>
                </div>
                <div>
                  <span className="text-gray-600">Ball:</span>{" "}
                  <span className="font-semibold">
                    {lastTick.prediction.legalBallNumber ?? "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Team A Win Prob:</span>{" "}
                  <span className="font-semibold">
                    {(lastTick.prediction.teamAWinProb * 100).toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Time:</span>{" "}
                  <span className="font-mono text-xs">
                    {new Date(lastTick.prediction.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Edge Signal Card */}
          {lastTick.edge && (
            <div
              className={`${
                isOpportunity
                  ? "bg-green-100 border-l-4 border-green-600"
                  : "bg-amber-50 border-l-4 border-amber-600"
              } p-4 rounded`}
            >
              <h3 className="font-semibold mb-2">
                {isOpportunity ? "🎯 OPPORTUNITY" : "📈 Edge Signal"}
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <span className="text-gray-600">Market:</span>{" "}
                  <span className="font-semibold">{lastTick.edge.marketName}</span>
                </div>
                <div>
                  <span className="text-gray-600">Model Prob A:</span>{" "}
                  <span className="font-semibold">
                    {(lastTick.edge.marketProbA_fair * 100).toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Market Fair Prob A:</span>{" "}
                  <span className="font-semibold">
                    {(lastTick.edge.marketProbA_fair * 100).toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Overround:</span>{" "}
                  <span className="font-semibold">
                    {((lastTick.edge.overround - 1) * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-600">Edge A:</span>{" "}
                  <span
                    className={`font-bold text-lg ${
                      Math.abs(lastTick.edge.edgeA) >= edgeThreshold
                        ? "text-green-700"
                        : "text-orange-700"
                    }`}
                  >
                    {lastTick.edge.edgeA > 0 ? "+" : ""}
                    {(lastTick.edge.edgeA * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
              <div className="text-xs text-gray-600 pt-2 border-t border-gray-300">
                Observed: {new Date(lastTick.edge.observedAt).toLocaleTimeString()}
              </div>
            </div>
          )}

          {/* Staleness Indicator */}
          {lastTick.staleness && (
            <div
              className={`${
                lastTick.staleness.stale ? "bg-yellow-100" : "bg-green-100"
              } border-l-4 ${
                lastTick.staleness.stale
                  ? "border-yellow-600"
                  : "border-green-600"
              } p-4 rounded`}
            >
              <h3 className="font-semibold mb-2">
                {lastTick.staleness.stale ? "⚠️ Data Staleness" : "✓ Fresh Data"}
              </h3>
              <div className="text-sm">
                <div>
                  <span className="text-gray-600">Time Difference:</span>{" "}
                  <span className="font-semibold">
                    {lastTick.staleness.secondsDiff}s
                  </span>
                </div>
                {lastTick.staleness.warning && (
                  <div className="text-yellow-800 mt-2">
                    {lastTick.staleness.warning}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-xs text-gray-500 border-t pt-4">
        <p>🔒 Never places bets; signals only</p>
        <p>Last updated: {lastTick?.timestamp ? new Date(lastTick.timestamp).toLocaleTimeString() : "—"}</p>
      </div>
    </div>
  );
}
