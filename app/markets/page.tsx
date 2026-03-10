"use client";

import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface RollbitEvent {
  eventId: number;
  home: string;
  away: string;
  date: string;
  status: string;
  league: string;
  homeOdds: number | null;
  awayOdds: number | null;
  homeFair: number | null;
  awayFair: number | null;
  overround: number | null;
}

interface PolyToken {
  tokenId: string;
  outcome: string;
  gammaPrice: number;
  bestBid: number;
  bestAsk: number;
  impliedProb: number;
}

interface PolyActivity {
  tradeCount: number;
  totalRecentVolume: number;
  netBuyPressure: number;            // –1 to +1
  outcomeBuyPressure: Record<string, number>; // fraction of buy volume per outcome
}

interface PolyMarket {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  endDate?: string;
  volume?: number;
  volume24hr?: number;
  volume1wk?: number;
  liquidity?: number;
  tokens: PolyToken[];
  activity: PolyActivity | null;
  observedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function BuyPressureBar({ value }: { value: number }) {
  // value: –1 (all sells) to +1 (all buys)
  const pct = ((value + 1) / 2) * 100; // map to 0–100
  const color = value > 0.2 ? "bg-green-500" : value < -0.2 ? "bg-red-500" : "bg-yellow-400";
  return (
    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
      <div
        className={`${color} h-1.5 rounded-full transition-all`}
        style={{ width: `${pct.toFixed(0)}%` }}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const [adminKey, setAdminKey] = useState<string>("");
  const [adminKeyInput, setAdminKeyInput] = useState<string>("");
  const [edgeThreshold, setEdgeThreshold] = useState<number>(0.03);
  const [signals, setSignals] = useState<EdgeSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedMatch, setSelectedMatch] = useState<string>("");
  const [pollStatus, setPollStatus] = useState<string>("");

  const [polyMarkets, setPolyMarkets] = useState<PolyMarket[]>([]);
  const [polyLoading, setPolyLoading] = useState(false);
  const [polyError, setPolyError] = useState("");
  const [polyQuery, setPolyQuery] = useState("cricket");
  const [polyLastFetched, setPolyLastFetched] = useState<string>("");

  const [rollbitEvents, setRollbitEvents] = useState<RollbitEvent[]>([]);
  const [rollbitLoading, setRollbitLoading] = useState(false);
  const [rollbitError, setRollbitError] = useState("");
  const [rollbitLastFetched, setRollbitLastFetched] = useState<string>("");
  const [rollbitActiveOnly, setRollbitActiveOnly] = useState(false);

  // Load admin key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("cricket_oracle_admin_key");
    if (saved) setAdminKey(saved);
  }, []);

  // Auto-load Polymarket + Rollbit panels on mount
  useEffect(() => {
    loadPolyMarkets();
    loadRollbitMarkets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Edge Signals ──────────────────────────────────────────────────────────

  async function loadSignals() {
    if (!adminKey) { setError("Admin key required"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/markets/signals", { headers: { "x-admin-key": adminKey } });
      if (res.status === 401) { setError("Unauthorized - invalid admin key"); return; }
      if (!res.ok) { const d = await res.json(); setError(d.error || "Failed to load signals"); return; }
      const data = await res.json();
      setSignals(data.signals || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function pollMatch() {
    if (!adminKey) { setPollStatus("Admin key required"); return; }
    if (!selectedMatch) { setPollStatus("Select a match first"); return; }
    setPollStatus("Polling...");
    try {
      const res = await fetch("/api/markets/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ matchId: selectedMatch }),
      });
      if (!res.ok) { const d = await res.json(); setPollStatus(`Error: ${d.message || d.error}`); return; }
      const data = await res.json();
      setPollStatus(`Processed ${data.edgeSignals?.length || 0} edge signals`);
      await loadSignals();
    } catch (err: any) {
      setPollStatus(err.message);
    }
  }

  const filteredSignals = signals.filter((s) => Math.abs(s.edgeA) >= edgeThreshold);
  const sortedSignals = [...filteredSignals].sort((a, b) => Math.abs(b.edgeA) - Math.abs(a.edgeA));

  // ── Rollbit Panel ─────────────────────────────────────────────────────────

  async function loadRollbitMarkets() {
    setRollbitLoading(true);
    setRollbitError("");
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (rollbitActiveOnly) params.set("activeOnly", "true");
      const res = await fetch(`/api/oddsapi/cricket?${params}`);
      if (!res.ok) { const d = await res.json(); setRollbitError(d.error || "Failed"); return; }
      const data = await res.json();
      setRollbitEvents(data.events ?? []);
      setRollbitLastFetched(new Date().toLocaleTimeString());
    } catch (err: any) {
      setRollbitError(err.message);
    } finally {
      setRollbitLoading(false);
    }
  }

  // ── Polymarket Panel ──────────────────────────────────────────────────────

  async function loadPolyMarkets() {
    setPolyLoading(true);
    setPolyError("");
    try {
      const res = await fetch(`/api/polymarket/markets?q=${encodeURIComponent(polyQuery)}`);
      if (!res.ok) { const d = await res.json(); setPolyError(d.error || "Failed"); return; }
      const data = await res.json();
      setPolyMarkets(data.markets ?? []);
      setPolyLastFetched(new Date().toLocaleTimeString());
    } catch (err: any) {
      setPolyError(err.message);
    } finally {
      setPolyLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-semibold">Edge Signals</h1>
        <a href="/match" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">
          ← Back to Match
        </a>
      </div>

      {/* Admin Key */}
      <div className="bg-blue-50 border border-blue-200 rounded p-4 space-y-3">
        <h3 className="font-semibold text-blue-900">Admin Key</h3>
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
            onClick={() => { setAdminKey(""); setAdminKeyInput(""); localStorage.removeItem("cricket_oracle_admin_key"); }}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Poll + Load */}
      <div className="grid grid-cols-2 gap-4">
        {/* Poll */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-purple-900">Poll Odds</h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Match ID"
              value={selectedMatch}
              onChange={(e) => setSelectedMatch(e.target.value)}
              className="flex-1 border rounded px-3 py-2 text-sm"
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
            <div className="bg-white border border-gray-300 rounded px-3 py-2 text-sm font-mono">{pollStatus}</div>
          )}
        </div>

        {/* Load signals */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Load Signals</h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1 text-gray-600">Min Edge</label>
              <input
                type="number"
                step="0.01"
                value={edgeThreshold}
                onChange={(e) => setEdgeThreshold(Number(e.target.value))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={loadSignals}
              disabled={!adminKey || loading}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-2 rounded text-sm font-medium"
            >
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-300 rounded p-3 text-red-700">{error}</div>
      )}

      {/* Edge Signals Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="font-semibold">Edge Signals ({sortedSignals.length} / {signals.length} total)</h3>
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
                    {loading ? "Loading..." : signals.length === 0 ? "No signals — poll a match to get started." : "No signals meet threshold."}
                  </td>
                </tr>
              ) : (
                sortedSignals.map((signal) => (
                  <tr key={signal.id} className={`border-b hover:bg-gray-50 ${signal.isStale ? "bg-yellow-50" : ""}`}>
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs">{signal.matchId.slice(0, 8)}…</div>
                      <div className="text-xs text-gray-600">{signal.teamA} vs {signal.teamB}</div>
                    </td>
                    <td className="px-4 py-2 font-medium">{signal.market}</td>
                    <td className="px-4 py-2 text-right font-mono">{signal.oddsA.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right font-mono">{signal.oddsB.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right font-mono">{(signal.marketProbA * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right font-mono">{(signal.teamAWinProb * 100).toFixed(1)}%</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${signal.edgeA > 0 ? "text-green-600" : signal.edgeA < 0 ? "text-red-600" : "text-gray-600"}`}>
                      {signal.edgeA > 0 ? "+" : ""}{(signal.edgeA * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{((signal.overround - 1) * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2">
                      <div className="text-xs">{new Date(signal.observedAt).toLocaleTimeString()}</div>
                      {signal.isStale && <div className="text-xs text-yellow-600">Stale</div>}
                      {signal.notes && <div className="text-xs text-gray-500">{signal.notes}</div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Rollbit Live Markets Panel ───────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gradient-to-r from-orange-50 to-red-50 border-b px-4 py-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Rollbit — Live Cricket Odds</h3>
            {rollbitLastFetched && (
              <div className="text-xs text-gray-500 mt-0.5">Last updated {rollbitLastFetched}</div>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={rollbitActiveOnly}
                onChange={(e) => setRollbitActiveOnly(e.target.checked)}
                className="rounded"
              />
              Active markets only
            </label>
            <button
              onClick={loadRollbitMarkets}
              disabled={rollbitLoading}
              className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium"
            >
              {rollbitLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {rollbitError && (
          <div className="px-4 py-3 text-sm text-red-600 bg-red-50 border-b">{rollbitError}</div>
        )}

        {rollbitLoading && rollbitEvents.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Fetching Rollbit cricket odds…</div>
        ) : rollbitEvents.filter((e) => e.homeOdds !== null).length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 space-y-1">
            <div className="font-medium text-gray-600">No active Rollbit cricket markets right now</div>
            <div className="text-xs text-gray-400">
              {rollbitEvents.length > 0
                ? `${rollbitEvents.length} upcoming matches found — Rollbit hasn't priced them yet`
                : "No upcoming cricket events found"}
            </div>
            <div className="text-xs text-gray-400">Markets typically open closer to IPL / T20I fixtures</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left">Match</th>
                  <th className="px-4 py-2 text-left">League</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-right">Home Odds</th>
                  <th className="px-4 py-2 text-right">Away Odds</th>
                  <th className="px-4 py-2 text-right">Home Fair%</th>
                  <th className="px-4 py-2 text-right">Away Fair%</th>
                  <th className="px-4 py-2 text-right">Vig</th>
                </tr>
              </thead>
              <tbody>
                {rollbitEvents
                  .filter((e) => e.homeOdds !== null)
                  .map((ev) => (
                    <tr key={ev.eventId} className="border-b hover:bg-orange-50 transition">
                      <td className="px-4 py-2">
                        <div className="font-medium">{ev.home}</div>
                        <div className="text-xs text-gray-500">vs {ev.away}</div>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 max-w-[160px] truncate">{ev.league}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {new Date(ev.date).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          ev.status === "live" ? "bg-green-100 text-green-700" :
                          ev.status === "pending" ? "bg-blue-100 text-blue-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {ev.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-orange-700">
                        {ev.homeOdds?.toFixed(2) ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-orange-700">
                        {ev.awayOdds?.toFixed(2) ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {ev.homeFair != null ? `${(ev.homeFair * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {ev.awayFair != null ? `${(ev.awayFair * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-500">
                        {ev.overround != null ? `${((ev.overround - 1) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Polymarket Live Markets Panel ────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b px-4 py-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Polymarket — Live Cricket Markets</h3>
            {polyLastFetched && (
              <div className="text-xs text-gray-500 mt-0.5">Last updated {polyLastFetched}</div>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <input
              value={polyQuery}
              onChange={(e) => setPolyQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadPolyMarkets()}
              placeholder="Search query…"
              className="border rounded px-3 py-1.5 text-sm w-36"
            />
            <button
              onClick={loadPolyMarkets}
              disabled={polyLoading}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium"
            >
              {polyLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {polyError && (
          <div className="px-4 py-3 text-sm text-red-600 bg-red-50 border-b">{polyError}</div>
        )}

        {polyLoading && polyMarkets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Fetching Polymarket cricket markets…</div>
        ) : polyMarkets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No cricket markets found. Try a different query.</div>
        ) : (
          <div className="divide-y">
            {polyMarkets.map((pm) => (
              <div key={pm.id} className="p-4 hover:bg-gray-50 transition">
                {/* Question + meta */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <a
                      href={`https://polymarket.com/event/${pm.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-sm hover:text-indigo-700 hover:underline"
                    >
                      {pm.question}
                    </a>
                    {pm.endDate && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Closes {new Date(pm.endDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500 shrink-0">
                    {pm.volume24hr != null && pm.volume24hr > 0 && (
                      <div className="text-center">
                        <div className="font-semibold text-gray-700">{fmtUSD(pm.volume24hr)}</div>
                        <div>24h vol</div>
                      </div>
                    )}
                    {pm.liquidity != null && pm.liquidity > 0 && (
                      <div className="text-center">
                        <div className="font-semibold text-gray-700">{fmtUSD(pm.liquidity)}</div>
                        <div>liquidity</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tokens + implied probs */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {pm.tokens.map((token) => {
                    const buyPct = pm.activity?.outcomeBuyPressure[token.outcome];
                    return (
                      <div
                        key={token.tokenId}
                        className="flex-1 min-w-[100px] bg-white border rounded px-3 py-2 text-sm"
                      >
                        <div className="flex justify-between items-baseline">
                          <span className="font-medium truncate max-w-[120px]">{token.outcome}</span>
                          <span className="font-mono font-bold text-indigo-700 ml-2">
                            {(token.impliedProb * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          bid {(token.bestBid * 100).toFixed(1)}¢ · ask {(token.bestAsk * 100).toFixed(1)}¢
                          {(token.bestAsk - token.bestBid) > 0 && (
                            <span className="ml-1 text-gray-300">
                              (spread {((token.bestAsk - token.bestBid) * 100).toFixed(1)}¢)
                            </span>
                          )}
                        </div>
                        {buyPct != null && (
                          <div className="text-xs text-gray-400 mt-1">
                            {(buyPct * 100).toFixed(0)}% of buys
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Trade flow bar */}
                {pm.activity && pm.activity.tradeCount > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>
                        {pm.activity.tradeCount} recent trades · {fmtUSD(pm.activity.totalRecentVolume)} volume
                      </span>
                      <span className={
                        pm.activity.netBuyPressure > 0.2 ? "text-green-600 font-medium" :
                        pm.activity.netBuyPressure < -0.2 ? "text-red-600 font-medium" :
                        "text-gray-500"
                      }>
                        {pm.activity.netBuyPressure > 0.2 ? "Net buying" :
                         pm.activity.netBuyPressure < -0.2 ? "Net selling" : "Balanced"}
                      </span>
                    </div>
                    <BuyPressureBar value={pm.activity.netBuyPressure} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm">
        <h4 className="font-semibold mb-2">Legend</h4>
        <ul className="space-y-1 text-gray-700">
          <li><span className="font-semibold">Edge</span> = Model P(A) - Market Fair P(A)</li>
          <li><span className="text-green-600 font-bold">+Edge</span> = Model favours Team A (value on A)</li>
          <li><span className="text-red-600 font-bold">-Edge</span> = Market favours Team A (value on B)</li>
          <li><span className="font-semibold">Net buying/selling</span> = Direction of recent Polymarket trade flow</li>
          <li><span className="font-semibold">Overround</span> = Bookmaker margin (vig)</li>
        </ul>
      </div>
    </div>
  );
}
