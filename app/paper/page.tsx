"use client";

import { useEffect, useState } from "react";

interface PaperOverviewResponse {
  ok: boolean;
  account: {
    id: string;
    name: string;
    currency: string;
    startingBalance: number;
    settledPnl: number;
    settledStake: number;
    balance: number;
  };
  openBets: Array<{
    id: string;
    matchId: string;
    side: string;
    stake: number;
    oddsDecimal: number;
    edgeA: number;
    placedAt: string;
    status: string;
    match: { teamA: string; teamB: string; winnerTeam?: string | null };
  }>;
  settledBets: Array<{
    id: string;
    matchId: string;
    side: string;
    stake: number;
    oddsDecimal: number;
    edgeA: number;
    result?: string | null;
    pnl?: number | null;
    settledAt?: string | null;
    match: { teamA: string; teamB: string; winnerTeam?: string | null };
  }>;
}

export default function PaperPage() {
  const [adminKey, setAdminKey] = useState("");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [accountName, setAccountName] = useState("default");
  const [matchIdFilter, setMatchIdFilter] = useState("");

  const [overview, setOverview] = useState<PaperOverviewResponse | null>(null);
  const [threshold, setThreshold] = useState(0.03);
  const [stake, setStake] = useState(10);
  const [limitMatches, setLimitMatches] = useState(100);
  const [includeTeamB, setIncludeTeamB] = useState(false);
  const [backtestSummary, setBacktestSummary] = useState<any>(null);
  const [settleSummary, setSettleSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("cricket_oracle_admin_key");
    if (saved) setAdminKey(saved);
  }, []);

  async function loadOverview() {
    if (!adminKey) {
      setError("Admin key required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const query = new URLSearchParams({ accountName });
      if (matchIdFilter.trim()) {
        query.set("matchId", matchIdFilter.trim());
      }

      const res = await fetch(`/api/paper/overview?${query.toString()}`, {
        headers: { "x-admin-key": adminKey },
      });

      if (res.status === 401) {
        setError("Unauthorized - invalid admin key");
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load paper overview");
        return;
      }

      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest() {
    if (!adminKey) {
      setError("Admin key required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/paper/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          threshold,
          stake,
          limitMatches,
          includeTeamB,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to run backtest");
        return;
      }

      setBacktestSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function settleOpenBets() {
    if (!adminKey) {
      setError("Admin key required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/paper/settle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          accountName,
          matchId: matchIdFilter.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to settle open bets");
        return;
      }

      setSettleSummary(data);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const setStoredKey = () => {
    if (!adminKeyInput.trim()) return;
    setAdminKey(adminKeyInput.trim());
    localStorage.setItem("cricket_oracle_admin_key", adminKeyInput.trim());
    setAdminKeyInput("");
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Paper Trading & Backtesting</h1>

      <div className="bg-blue-50 border border-blue-200 rounded p-4 space-y-3">
        <h2 className="font-semibold">Admin Key</h2>
        <div className="flex gap-2">
          <input
            type="password"
            value={adminKeyInput}
            onChange={(e) => setAdminKeyInput(e.target.value)}
            placeholder="Enter admin key"
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={setStoredKey}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Save
          </button>
          <button
            onClick={() => {
              setAdminKey("");
              setAdminKeyInput("");
              localStorage.removeItem("cricket_oracle_admin_key");
            }}
            className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-700"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 border border-gray-200 rounded p-4">
        <div>
          <label className="block text-sm font-medium mb-1">Account</label>
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Match Filter</label>
          <input
            value={matchIdFilter}
            onChange={(e) => setMatchIdFilter(e.target.value)}
            placeholder="optional matchId"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={loadOverview}
            disabled={!adminKey || loading}
            className="w-full px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400"
          >
            {loading ? "Loading..." : "Refresh Overview"}
          </button>
        </div>
        <div className="flex items-end">
          <button
            onClick={settleOpenBets}
            disabled={!adminKey || loading}
            className="w-full px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400"
          >
            Settle Open Bets
          </button>
        </div>
      </div>

      {settleSummary && (
        <div className="bg-indigo-50 border border-indigo-200 rounded p-3 text-sm">
          Settled {settleSummary.settledCount} / {settleSummary.openBetsScanned} open bets, skipped {settleSummary.skippedNoResult} (no winner), total pnl {Number(settleSummary.totalPnl || 0).toFixed(2)}
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="border rounded p-4 bg-white">
            <div className="text-sm text-gray-500">Starting Balance</div>
            <div className="text-2xl font-semibold">
              {overview.account.currency} {overview.account.startingBalance.toFixed(2)}
            </div>
          </div>
          <div className="border rounded p-4 bg-white">
            <div className="text-sm text-gray-500">Settled PnL</div>
            <div className={`text-2xl font-semibold ${overview.account.settledPnl >= 0 ? "text-green-700" : "text-red-700"}`}>
              {overview.account.currency} {overview.account.settledPnl.toFixed(2)}
            </div>
          </div>
          <div className="border rounded p-4 bg-white">
            <div className="text-sm text-gray-500">Computed Balance</div>
            <div className="text-2xl font-semibold">
              {overview.account.currency} {overview.account.balance.toFixed(2)}
            </div>
          </div>
          <div className="border rounded p-4 bg-white">
            <div className="text-sm text-gray-500">Total Settled Stake</div>
            <div className="text-2xl font-semibold">
              {overview.account.currency} {overview.account.settledStake.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded p-4">
        <h2 className="font-semibold mb-3">Backtest edge-v1</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Threshold</label>
            <input
              type="number"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Flat Stake</label>
            <input
              type="number"
              step="1"
              value={stake}
              onChange={(e) => setStake(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Match Limit</label>
            <input
              type="number"
              step="1"
              value={limitMatches}
              onChange={(e) => setLimitMatches(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 mt-7 text-sm">
            <input
              type="checkbox"
              checked={includeTeamB}
              onChange={(e) => setIncludeTeamB(e.target.checked)}
            />
            Include Team B bets
          </label>
          <div className="flex items-end">
            <button
              onClick={runBacktest}
              disabled={!adminKey || loading}
              className="w-full px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:bg-gray-400"
            >
              Run Backtest
            </button>
          </div>
        </div>
        {backtestSummary && (
          <div className="mt-4 text-sm bg-white border border-gray-200 rounded p-3">
            <div>Bets: {backtestSummary.bets}</div>
            <div>Win rate: {(backtestSummary.winRate * 100).toFixed(2)}%</div>
            <div>Total PnL: {backtestSummary.totalPnl.toFixed(2)}</div>
            <div>ROI: {(backtestSummary.roi * 100).toFixed(2)}%</div>
            <div>Avg odds: {backtestSummary.averageOdds.toFixed(3)}</div>
          </div>
        )}
      </div>

      {error && <div className="bg-red-100 border border-red-300 rounded p-3 text-red-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded bg-white overflow-auto">
          <div className="px-4 py-3 border-b font-semibold">Open Bets</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Side</th>
                <th className="px-3 py-2 text-right">Stake</th>
                <th className="px-3 py-2 text-right">Odds</th>
                <th className="px-3 py-2 text-right">Edge</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.openBets || []).map((bet) => (
                <tr key={bet.id} className="border-b">
                  <td className="px-3 py-2">{bet.match.teamA} vs {bet.match.teamB}</td>
                  <td className="px-3 py-2">{bet.side}</td>
                  <td className="px-3 py-2 text-right">{bet.stake.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{bet.oddsDecimal.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{(bet.edgeA * 100).toFixed(2)}%</td>
                </tr>
              ))}
              {(overview?.openBets || []).length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={5}>
                    No open bets
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border rounded bg-white overflow-auto">
          <div className="px-4 py-3 border-b font-semibold">Settled Bets</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Result</th>
                <th className="px-3 py-2 text-right">Stake</th>
                <th className="px-3 py-2 text-right">Odds</th>
                <th className="px-3 py-2 text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.settledBets || []).map((bet) => (
                <tr key={bet.id} className="border-b">
                  <td className="px-3 py-2">{bet.match.teamA} vs {bet.match.teamB}</td>
                  <td className="px-3 py-2">{bet.result || "-"}</td>
                  <td className="px-3 py-2 text-right">{bet.stake.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{bet.oddsDecimal.toFixed(2)}</td>
                  <td className={`px-3 py-2 text-right ${(bet.pnl || 0) >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {(bet.pnl || 0).toFixed(2)}
                  </td>
                </tr>
              ))}
              {(overview?.settledBets || []).length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={5}>
                    No settled bets
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Simulation only. No real-money action is executed anywhere in this flow.
      </div>
    </div>
  );
}
