/**
 * Latest realtime data query helpers
 */

import { prisma } from "@/lib/db/prisma";

export async function getLatestBallPrediction(
  matchId: string,
  modelVersion: string = "v3-lgbm"
) {
  return await prisma.ballPrediction.findFirst({
    where: { matchId, modelVersion },
    orderBy: [
      { innings: "desc" },
      { legalBallNumber: "desc" },
      { createdAt: "desc" },
    ],
  });
}

export async function getLatestEdgeSignal(matchId: string) {
  return await prisma.edgeSignal.findFirst({
    where: { matchId },
    orderBy: { observedAt: "desc" },
    include: {
      marketEvent: {
        include: {
          market: true,
          oddsTicks: {
            where: { observedAt: { gte: new Date(Date.now() - 60000) } },
            orderBy: { observedAt: "desc" },
            take: 2,
          },
        },
      },
    },
  });
}

export async function getLatestOddsForMatch(matchId: string) {
  const latest = await prisma.marketEvent.findFirst({
    where: { matchId },
    orderBy: { createdAt: "desc" },
    include: {
      oddsTicks: {
        orderBy: { observedAt: "desc" },
        take: 2,
      },
      market: true,
    },
  });
  return latest;
}

export interface TickResponse {
  ok: boolean;
  matchId: string;
  timestamp: Date;
  prediction?: {
    innings: number;
    legalBallNumber: number | null;
    teamAWinProb: number;
    createdAt: Date;
  };
  edge?: {
    marketName: string;
    observedAt: Date;
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
  message?: string;
}
