/**
 * Latest realtime data query helpers
 */

import { prisma } from "@/lib/db/prisma";
import { getDefaultModelVersion } from "@/lib/model";

export async function getLatestBallPrediction(
  matchId: string,
  modelVersion: string | null = null
) {
  // If not specified, use the default model version
  const version = modelVersion ?? getDefaultModelVersion();
  return await prisma.ballPrediction.findFirst({
    where: { matchId, modelVersion: version },
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
    overround: number | null;
    edgeA: number;
  };
  staleness?: {
    stale: boolean;
    secondsDiff: number;
    warning?: string;
  };
  provider?: {
    liveProvider?: string;
    deliveriesProcessed?: number;
    nextCursor?: string | null;
    lastProviderEventId?: string | null;
  };
  message?: string;
}
