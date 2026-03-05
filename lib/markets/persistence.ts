/**
 * Helper functions for persisting odds ticks and edge signals
 */

import { prisma } from "@/lib/db/prisma";
import { mapTeamNameToSide } from "@/lib/teams/mapToSide";
import type { Match } from "@prisma/client";

export interface OddsSelection {
  teamName: string;
  oddsDecimal: number;
}

export interface MarketSnapshot {
  marketName: string;
  externalEventId: string;
  observedAt: string; // ISO datetime
  selections: OddsSelection[];
}

export interface PersistOddsResult {
  marketId: string;
  marketEventId: string;
  ticksUpserted: number;
  oddsA: number | null;
  oddsB: number | null;
}

/**
 * Persist odds ticks for a market snapshot
 */
export async function persistOddsTicks(
  match: { id: string; teamA: string; teamB: string },
  snapshot: MarketSnapshot
): Promise<PersistOddsResult> {
  // 1. Upsert Market
  const market = await prisma.market.upsert({
    where: { name: snapshot.marketName },
    create: { name: snapshot.marketName },
    update: {},
  });

  // 2. Upsert MarketEvent
  const marketEvent = await prisma.marketEvent.upsert({
    where: {
      marketId_externalEventId: {
        marketId: market.id,
        externalEventId: snapshot.externalEventId,
      },
    },
    create: {
      matchId: match.id,
      marketId: market.id,
      externalEventId: snapshot.externalEventId,
      selectionTeamAName: match.teamA,
      selectionTeamBName: match.teamB,
    },
    update: {},
  });

  const observedAt = new Date(snapshot.observedAt);
  let oddsA: number | null = null;
  let oddsB: number | null = null;
  let ticksUpserted = 0;

  // 3. Upsert OddsTicks for each selection
  for (const sel of snapshot.selections) {
    const side = mapTeamNameToSide(match, sel.teamName);
    const impliedProbRaw = 1 / sel.oddsDecimal;

    if (side === "A") oddsA = sel.oddsDecimal;
    if (side === "B") oddsB = sel.oddsDecimal;

    await prisma.oddsTick.upsert({
      where: {
        marketEventId_observedAt_side: {
          marketEventId: marketEvent.id,
          observedAt,
          side,
        },
      },
      create: {
        marketEventId: marketEvent.id,
        observedAt,
        side,
        teamName: sel.teamName,
        oddsDecimal: sel.oddsDecimal,
        impliedProbRaw,
        provider: snapshot.marketName,
        providerEventId: snapshot.externalEventId,
        sourceJson: sel as any,
      },
      update: {
        oddsDecimal: sel.oddsDecimal,
        impliedProbRaw,
        teamName: sel.teamName,
      },
    });

    ticksUpserted++;
  }

  return {
    marketId: market.id,
    marketEventId: marketEvent.id,
    ticksUpserted,
    oddsA,
    oddsB,
  };
}

export interface EdgeSignalData {
  matchId: string;
  marketEventId: string;
  modelVersion: string;
  observedAt: Date;
  predictionId?: string;
  teamAWinProb: number;
  marketProbA_raw: number;
  marketProbA_fair: number;
  overround: number;
  edgeA: number;
  notes?: string;
}

/**
 * Create or update edge signal
 */
export async function upsertEdgeSignal(data: EdgeSignalData) {
  return await prisma.edgeSignal.upsert({
    where: {
      matchId_marketEventId_modelVersion_observedAt: {
        matchId: data.matchId,
        marketEventId: data.marketEventId,
        modelVersion: data.modelVersion,
        observedAt: data.observedAt,
      },
    },
    create: data,
    update: {
      teamAWinProb: data.teamAWinProb,
      marketProbA_raw: data.marketProbA_raw,
      marketProbA_fair: data.marketProbA_fair,
      overround: data.overround,
      edgeA: data.edgeA,
      notes: data.notes,
      predictionId: data.predictionId,
    },
  });
}
