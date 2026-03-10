"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SeriesPoint {
  innings: number;
  legalBallNumber: number;
  teamAWinProb: number;
  createdAt: string;
}

interface MarketData {
  ok: boolean;
  matchId: string;
  prediction: {
    innings: number;
    legalBallNumber: number;
    teamAWinProb: number;
    createdAt: string;
  } | null;
  market: {
    marketName: string;
    marketType: string;
    observedAt: string;
    oddsA: number | null;
    oddsB: number | null;
    marketProbA_fair: number | null;
    overround: number | null;
  } | null;
  edge: {
    marketName: string;
    observedAt: string;
    marketProbA_fair: number;
    marketProbA_raw: number;
    overround: number | null;
    edgeA: number;
    stale: boolean;
    stalenessSeconds: number;
  } | null;
}

interface TickResponse {
  ok: boolean;
  matchId: string;
  timestamp: string;
  prediction?: {
    innings: number;
    legalBallNumber: number | null;
    teamAWinProb: number;
    createdAt: string;
  };
  provider?: {
    liveProvider?: string;
    deliveriesProcessed?: number;
    nextCursor?: string | null;
    lastProviderEventId?: string | null;
  };
}

export default function DashboardPage() {
  const [adminKey, setAdminKey] = useState<string>("");
  const [adminKeyInput, setAdminKeyInput] = useState<string>("");
  const [matchId, setMatchId] = useState<string>("");
  const [liveProvider, setLiveProvider] = useState<string>("none");
  const [edgeThreshold, setEdgeThreshold] = useState<number>(0.03);
  const [stalenessThreshold, setStalenessThreshold] = useState<number>(10);
  const [compareModels, setCompareModels] = useState<boolean>(false);

  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [seriesV4, setSeriesV4] = useState<SeriesPoint[]>([]);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [autoTicking, setAutoTicking] = useState<boolean>(false);
  const [tickCount, setTickCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [modelDelta, setModelDelta] = useState<number | null>(null);
  const autoTickRef = useRef<NodeJS.Timeout | null>(null);

  // Load admin key from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("cricket_oracle_admin_key");
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

  const handleSetAdminKey = () => {
    setAdminKey(adminKeyInput);
    localStorage.setItem("cricket_oracle_admin_key", adminKeyInput);
    setAdminKeyInput("");
  };

  const fetchSeries = useCallback(async () => {
    if (!adminKey || !matchId) return;
    try {
      const res = await fetch(
        `/api/realtime/series?matchId=${matchId}&modelVersion=v3-lgbm&limit=240`,
        {
          headers: { "x-admin-key": adminKey },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setSeries(data.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch series:", err);
    }
  }, [adminKey, matchId]);

  const fetchSeriesV4 = useCallback(async () => {
    if (!adminKey || !matchId) return;
    try {
      const res = await fetch(
        `/api/realtime/series?matchId=${matchId}&modelVersion=v4-logreg&limit=240`,
        {
          headers: { "x-admin-key": adminKey },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setSeriesV4(data.data || []);
        
        // Compute latest delta if both series exist
        const v3Latest = data.data && data.data.length > 0 ? data.data[data.data.length - 1] : null;
        const v4Latest = series && series.length > 0 ? series[series.length - 1] : null;
        if (v3Latest && v4Latest) {
          setModelDelta(v3Latest.teamAWinProb - v4Latest.teamAWinProb);
        }
      }
    } catch (err) {
      console.error("Failed to fetch v4 series:", err);
    }
  }, [adminKey, matchId, series]);

  const fetchMarket = useCallback(async () => {
    if (!adminKey || !matchId) return;
    try {
      const res = await fetch(`/api/markets/latest?matchId=${matchId}`, {
        headers: { "x-admin-key": adminKey },
      });
      if (res.ok) {
        const data = await res.json();
        setMarket(data);
      }
    } catch (err) {
      console.error("Failed to fetch market:", err);
    }
  }, [adminKey, matchId]);

  const runTick = async () => {
    if (!adminKey || !matchId) {
      setError("Admin key and match ID required");
      return;
    }

    setLoading(true);
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
          liveProvider: liveProvider !== "none" ? liveProvider : undefined,
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

      setTickCount((c) => c + 1);

      // Refresh series and market after tick
      await fetchSeries();
      await fetchMarket();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-tick loop
  useEffect(() => {
    if (autoTicking && adminKey && matchId) {
      autoTickRef.current = setInterval(() => {
        runTick();
      }, 1200);

      return () => {
        if (autoTickRef.current) clearInterval(autoTickRef.current);
      };
    }

    return () => {
      if (autoTickRef.current) clearInterval(autoTickRef.current);
    };
  }, [autoTicking, adminKey, matchId]);

  const handleReset = async () => {
    if (!adminKey || !matchId) return;
    try {
      const res = await fetch("/api/realtime/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ matchId }),
      });
      if (res.ok) {
        setSeries([]);
        setMarket(null);
        setTickCount(0);
        // Refresh data
        await fetchSeries();
        await fetchMarket();
      }
    } catch (err) {
      console.error("Reset failed:", err);
    }
  };

  const isOpportunity =
    market?.edge &&
    Math.abs(market.edge.edgeA) >= edgeThreshold &&
    !market.edge.stale;

  // Simple SVG line chart
  const renderChart = () => {
    if (series.length === 0) {
      return <div className="text-center text-gray-500 py-8">No data</div>;
    }

    const width = 800;
    const height = 300;
    const padding = 40;

    const minY = 0;
    const maxY = 1;
    const scaleX = (width - padding * 2) / (series.length - 1 || 1);
    const scaleY = (height - padding * 2) / (maxY - minY);

    const points = series
      .map((p, i) => {
        const x = padding + i * scaleX;
        const y = height - padding - (p.teamAWinProb - minY) * scaleY;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <div className="bg-white border border-gray-300 rounded p-4">
        <h3 className="text-lg font-semibold mb-4">Team A Win Probability</h3>
        <svg width={width} height={height} className="border border-gray-200">
          {/* Y-axis */}
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={height - padding}
            stroke="black"
            strokeWidth="2"
          />
          {/* X-axis */}
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke="black"
            strokeWidth="2"
          />

          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((val) => (
            <g key={val}>
              <line
                x1={padding - 5}
                y1={height - padding - (val - minY) * scaleY}
                x2={padding}
                y2={height - padding - (val - minY) * scaleY}
                stroke="black"
              />
              <text
                x={padding - 10}
                y={height - padding - (val - minY) * scaleY + 4}
                textAnchor="end"
                fontSize="12"
              >
                {(val * 100).toFixed(0)}%
              </text>
            </g>
          ))}

          {/* Line chart */}
          <polyline
            points={points}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
          />

          {/* Latest point highlight */}
          {series.length > 0 && (
            <circle
              cx={padding + (series.length - 1) * scaleX}
              cy={height - padding - (series[series.length - 1].teamAWinProb - minY) * scaleY}
              r="4"
              fill="#dc2626"
            />
          )}
        </svg>
        <p className="text-sm text-gray-600 mt-2">
          {series.length} predictions | Latest: {series[series.length - 1]?.teamAWinProb.toFixed(3)}
        </p>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-4xl font-bold">📊 Realtime Dashboard</h1>

      {/* Admin Key */}
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

      {/* Controls */}
      <div className="bg-gray-50 border border-gray-300 rounded p-4 space-y-4">
        <h2 className="text-xl font-semibold">Controls</h2>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Match ID</label>
            <input
              type="text"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              placeholder="Enter match ID"
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Live Provider
            </label>
            <select
              value={liveProvider}
              onChange={(e) => setLiveProvider(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              <option value="none">None</option>
              <option value="file-sim">File Simulator</option>
              <option value="ball-events">Ball Events (Imported)</option>
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
              min="0"
              max="1"
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Staleness Threshold (seconds)
            </label>
            <input
              type="number"
              value={stalenessThreshold}
              onChange={(e) => setStalenessThreshold(parseInt(e.target.value))}
              min="1"
              max="60"
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={runTick}
              disabled={loading || !adminKey || !matchId}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              Tick Once
            </button>
            <button
              onClick={() =>
                setAutoTicking(!autoTicking)
              }
              className={`px-4 py-2 text-white rounded ${
                autoTicking
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {autoTicking ? "Stop Auto Tick" : "Start Auto Tick"}
            </button>
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={handleReset}
              disabled={!adminKey || !matchId}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:bg-gray-400"
            >
              Reset Provider
            </button>
            <button
              onClick={() => {
                fetchSeries();
                fetchMarket();
              }}
              disabled={!adminKey || !matchId}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:bg-gray-400"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-blue-600 font-semibold">Processing tick...</div>
        )}

        <div className="text-sm text-gray-600">
          Ticks executed: {tickCount}
        </div>
      </div>

      {/* Chart */}
      {matchId && adminKey && (
        <div>{renderChart()}</div>
      )}

      {/* Latest snapshots */}
      {market && (
        <div className="grid grid-cols-3 gap-4">
          {/* Model card */}
          <div className="bg-white border border-gray-300 rounded p-4">
            <h3 className="text-lg font-semibold mb-3">🔮 Model</h3>
            {market.prediction ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-semibold">Innings</dt>
                  <dd>{market.prediction.innings}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Legal Ball #</dt>
                  <dd>{market.prediction.legalBallNumber}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Team A Win %</dt>
                  <dd className="text-lg font-bold text-blue-600">
                    {(market.prediction.teamAWinProb * 100).toFixed(1)}%
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Updated</dt>
                  <dd className="text-xs">
                    {new Date(market.prediction.createdAt).toLocaleTimeString()}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-gray-500">No predictions yet</p>
            )}
          </div>

          {/* Market card */}
          <div className="bg-white border border-gray-300 rounded p-4">
            <h3 className="text-lg font-semibold mb-3">📈 Market</h3>
            {market.market ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-semibold">{market.market.marketName}</dt>
                </div>
                {market.market.oddsA !== null && (
                  <>
                    <div>
                      <dt className="font-semibold">Odds A</dt>
                      <dd>{market.market.oddsA.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Odds B</dt>
                      <dd>{market.market.oddsB?.toFixed(2)}</dd>
                    </div>
                  </>
                )}
                {market.market.marketProbA_fair !== null && (
                  <div>
                    <dt className="font-semibold">Fair Prob A</dt>
                    <dd className="text-lg font-bold">
                      {(market.market.marketProbA_fair * 100).toFixed(1)}%
                    </dd>
                  </div>
                )}
                {market.market.overround !== null && (
                  <div>
                    <dt className="font-semibold">Overround</dt>
                    <dd>{(market.market.overround * 100).toFixed(1)}%</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-gray-500">No market data</p>
            )}
          </div>

          {/* Edge card */}
          <div
            className={`border rounded p-4 ${
              isOpportunity
                ? "bg-yellow-50 border-yellow-500"
                : market.edge?.stale
                  ? "bg-gray-100 border-gray-400"
                  : "bg-white border-gray-300"
            }`}
          >
            <h3 className="text-lg font-semibold mb-3">
              {isOpportunity ? "⚡ OPPORTUNITY" : "🎯 Edge"}
            </h3>
            {market.edge ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-semibold">{market.edge.marketName}</dt>
                </div>
                <div>
                  <dt className="font-semibold">Edge A</dt>
                  <dd
                    className={`text-lg font-bold ${
                      market.edge.edgeA > 0
                        ? "text-green-600"
                        : market.edge.edgeA < 0
                          ? "text-red-600"
                          : ""
                    }`}
                  >
                    {(market.edge.edgeA * 100).toFixed(2)}%
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Staleness</dt>
                  <dd
                    className={`${
                      market.edge.stale ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {market.edge.stalenessSeconds}s
                    {market.edge.stale ? " ⚠️ STALE" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Market Prob A</dt>
                  <dd>{(market.edge.marketProbA_fair * 100).toFixed(1)}%</dd>
                </div>
              </dl>
            ) : (
              <p className="text-gray-500">No edge data</p>
            )}
          </div>
        </div>
      )}

      {/* Model Comparison */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-300 rounded p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">🔄 Model Comparison (v3 vs v4)</h3>
          <button
            onClick={() => {
              setCompareModels(!compareModels);
              if (!compareModels) {
                fetchSeriesV4();
              }
            }}
            className={`px-3 py-1 text-sm rounded text-white ${
              compareModels
                ? "bg-purple-600 hover:bg-purple-700"
                : "bg-gray-500 hover:bg-gray-600"
            }`}
          >
            {compareModels ? "Hide Comparison" : "Show Comparison"}
          </button>
        </div>

        {compareModels && (
          <div className="space-y-3">
            {market?.prediction && seriesV4.length > 0 && (
              <div
                className={`p-3 rounded ${
                  modelDelta && Math.abs(modelDelta) > 0.15
                    ? "bg-yellow-100 border border-yellow-500"
                    : "bg-white border border-gray-300"
                }`}
              >
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="font-semibold">V3 Prediction</dt>
                    <dd className="text-lg text-blue-600 font-bold">
                      {(market.prediction.teamAWinProb * 100).toFixed(1)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">V4 Prediction</dt>
                    <dd className="text-lg text-indigo-600 font-bold">
                      {(seriesV4[seriesV4.length - 1]?.teamAWinProb * 100 || 0).toFixed(
                        1
                      )}%
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Delta (V3-V4)</dt>
                    <dd
                      className={`text-lg font-bold ${
                        modelDelta === null
                          ? "text-gray-500"
                          : Math.abs(modelDelta) > 0.15
                            ? "text-red-600"
                            : "text-green-600"
                      }`}
                    >
                      {modelDelta === null
                        ? "N/A"
                        : (modelDelta * 100).toFixed(1) + "%"}
                    </dd>
                  </div>
                </div>
                {modelDelta && Math.abs(modelDelta) > 0.15 && (
                  <p className="text-sm text-yellow-700 mt-2 font-semibold">
                    ⚠️ Large divergence detected: models disagree significantly
                  </p>
                )}
              </div>
            )}
            {seriesV4.length === 0 && compareModels && (
              <p className="text-sm text-gray-600">
                Loading v4 predictions...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
