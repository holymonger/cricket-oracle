import { prisma } from "@/lib/db/prisma";
import { evaluateEdgeSignalForBet } from "@/lib/paper/strategyEdgeV1";

export interface BacktestRunOptions {
  threshold?: number;
  stake?: number;
  includeTeamB?: boolean;
  limitMatches?: number;
}

export interface SimulatedBet {
  matchId: string;
  side: "A" | "B";
  stake: number;
  oddsDecimal: number;
  edgeA: number;
  observedAt: Date;
  winnerTeam: "A" | "B";
  result: "win" | "loss" | "push";
  pnl: number;
}

export interface BacktestSummary {
  matchesProcessed: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
  averageOdds: number;
  pnlDistribution: {
    p10: number;
    p50: number;
    p90: number;
    min: number;
    max: number;
  };
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.max(0, Math.min(sortedValues.length - 1, Math.round((sortedValues.length - 1) * p)));
  return sortedValues[idx];
}

export function settlePnl(
  side: "A" | "B",
  winnerTeam: "A" | "B",
  stake: number,
  oddsDecimal: number
): { result: "win" | "loss" | "push"; pnl: number } {
  if (side === winnerTeam) {
    return {
      result: "win",
      pnl: stake * (oddsDecimal - 1),
    };
  }

  return {
    result: "loss",
    pnl: -stake,
  };
}

export async function runBacktestEdgeV1(
  options: BacktestRunOptions = {}
): Promise<{ summary: BacktestSummary; bets: SimulatedBet[] }> {
  const threshold = options.threshold ?? 0.03;
  const stake = options.stake ?? 10;
  const includeTeamB = options.includeTeamB ?? false;
  const limitMatches = options.limitMatches ?? 100;

  const matches = await prisma.match.findMany({
    where: {
      winnerTeam: { in: ["A", "B"] },
      edgeSignals: { some: {} },
    },
    select: {
      id: true,
      winnerTeam: true,
      edgeSignals: {
        orderBy: [{ observedAt: "asc" }, { createdAt: "asc" }],
      },
    },
    take: limitMatches,
    orderBy: { createdAt: "desc" },
  });

  const simulatedBets: SimulatedBet[] = [];

  for (const match of matches) {
    const winner = match.winnerTeam as "A" | "B" | null;
    if (!winner) continue;

    let placedForMatch = false;

    for (const signal of match.edgeSignals) {
      if (placedForMatch) break;

      const [oddsA, oddsB] = await Promise.all([
        prisma.oddsTick.findFirst({
          where: {
            marketEventId: signal.marketEventId,
            side: "A",
            observedAt: { lte: signal.observedAt },
          },
          orderBy: { observedAt: "desc" },
        }),
        prisma.oddsTick.findFirst({
          where: {
            marketEventId: signal.marketEventId,
            side: "B",
            observedAt: { lte: signal.observedAt },
          },
          orderBy: { observedAt: "desc" },
        }),
      ]);

      const candidate = evaluateEdgeSignalForBet({
        edgeSignal: signal,
        oddsA,
        oddsB,
        stake,
        options: {
          threshold,
          includeTeamB,
        },
      });

      if (!candidate) continue;

      const settlement = settlePnl(
        candidate.side,
        winner,
        candidate.stake,
        candidate.oddsDecimal
      );

      simulatedBets.push({
        matchId: match.id,
        side: candidate.side,
        stake: candidate.stake,
        oddsDecimal: candidate.oddsDecimal,
        edgeA: candidate.edgeA,
        observedAt: candidate.observedAt,
        winnerTeam: winner,
        result: settlement.result,
        pnl: settlement.pnl,
      });

      placedForMatch = true;
    }
  }

  const wins = simulatedBets.filter((b) => b.result === "win").length;
  const losses = simulatedBets.filter((b) => b.result === "loss").length;
  const pushes = simulatedBets.filter((b) => b.result === "push").length;
  const totalStaked = simulatedBets.reduce((sum, b) => sum + b.stake, 0);
  const totalPnl = simulatedBets.reduce((sum, b) => sum + b.pnl, 0);
  const averageOdds =
    simulatedBets.length > 0
      ? simulatedBets.reduce((sum, b) => sum + b.oddsDecimal, 0) / simulatedBets.length
      : 0;
  const winRate = simulatedBets.length > 0 ? wins / simulatedBets.length : 0;
  const roi = totalStaked > 0 ? totalPnl / totalStaked : 0;
  const pnls = simulatedBets.map((b) => b.pnl).sort((a, b) => a - b);

  return {
    bets: simulatedBets,
    summary: {
      matchesProcessed: matches.length,
      bets: simulatedBets.length,
      wins,
      losses,
      pushes,
      winRate,
      totalStaked,
      totalPnl,
      roi,
      averageOdds,
      pnlDistribution: {
        p10: percentile(pnls, 0.1),
        p50: percentile(pnls, 0.5),
        p90: percentile(pnls, 0.9),
        min: pnls.length ? pnls[0] : 0,
        max: pnls.length ? pnls[pnls.length - 1] : 0,
      },
    },
  };
}
