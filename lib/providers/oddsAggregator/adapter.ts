/**
 * Odds Aggregator Adapter
 * Processes raw aggregator data into normalized format for database storage
 */

import type { AggregatorMarket, AggregatorPayload } from "./client";
import { mapTeamNameToSide, TeamMappingError } from "../../teams/mapToSide";
import {
  impliedProbRawFromDecimal,
  fairProbAFromTwoSidedDecimal,
} from "../../markets/decimal";

/**
 * Normalized odds for one side
 */
export interface NormalizedOddsTick {
  side: "A" | "B";
  oddsDecimal: number;
  impliedProbRaw: number;
  sourceJson?: any;
}

/**
 * Normalized market event ready for database insert
 */
export interface NormalizedMarketEvent {
  marketName: string;
  externalEventId: string;
  observedAt: Date;
  selectionTeamAName: string;
  selectionTeamBName: string;
  oddsTicks: NormalizedOddsTick[];
  fairProbA: number;
  fairProbB: number;
  overround: number;
  isTwoSided: boolean;
  notes?: string;
}

/**
 * Result of processing aggregator payload
 */
export interface AdapterResult {
  matchId: string;
  timestamp: Date;
  events: NormalizedMarketEvent[];
  errors: Array<{ market: string; error: string }>;
}

/**
 * Process aggregator payload into normalized format
 * 
 * @param payload - Raw payload from aggregator API
 * @param match - Match details for team name mapping
 * @returns Normalized events ready for database
 */
export function processAggregatorPayload(
  payload: AggregatorPayload,
  match: { id: string; teamA: string; teamB: string }
): AdapterResult {
  const result: AdapterResult = {
    matchId: payload.matchId,
    timestamp: new Date(payload.timestamp),
    events: [],
    errors: [],
  };

  for (const market of payload.markets) {
    try {
      const normalized = normalizeMarket(market, match);
      result.events.push(normalized);
    } catch (error: any) {
      result.errors.push({
        market: market.marketName,
        error: error.message,
      });
    }
  }

  return result;
}

/**
 * Normalize a single market's data
 */
function normalizeMarket(
  market: AggregatorMarket,
  match: { id: string; teamA: string; teamB: string }
): NormalizedMarketEvent {
  const { marketName, externalEventId, observedAt, selections } = market;

  // Map selections to sides
  const selectionsBySide: Record<"A" | "B", { teamName: string; odds: number } | null> = {
    A: null,
    B: null,
  };

  for (const selection of selections) {
    try {
      const side = mapTeamNameToSide(match, selection.teamName);
      selectionsBySide[side] = {
        teamName: selection.teamName,
        odds: selection.oddsDecimal,
      };
    } catch (error) {
      if (error instanceof TeamMappingError) {
        throw new Error(
          `Team mapping failed for market ${marketName}: ${error.message}`
        );
      }
      throw error;
    }
  }

  // Check if we have both sides
  const sideA = selectionsBySide.A;
  const sideB = selectionsBySide.B;

  if (!sideA || !sideB) {
    // One-sided market - use raw probabilities
    const oddsTicks: NormalizedOddsTick[] = [];
    let fairProbA = 0.5;
    let fairProbB = 0.5;
    let overround = 1.0;

    if (sideA) {
      const impliedRaw = impliedProbRawFromDecimal(sideA.odds);
      oddsTicks.push({
        side: "A",
        oddsDecimal: sideA.odds,
        impliedProbRaw: impliedRaw,
      });
      fairProbA = impliedRaw;
      fairProbB = 1 - impliedRaw;
    }

    if (sideB) {
      const impliedRaw = impliedProbRawFromDecimal(sideB.odds);
      oddsTicks.push({
        side: "B",
        oddsDecimal: sideB.odds,
        impliedProbRaw: impliedRaw,
      });
      fairProbB = impliedRaw;
      fairProbA = 1 - impliedRaw;
    }

    return {
      marketName,
      externalEventId,
      observedAt: new Date(observedAt),
      selectionTeamAName: sideA?.teamName || "unknown",
      selectionTeamBName: sideB?.teamName || "unknown",
      oddsTicks,
      fairProbA,
      fairProbB,
      overround,
      isTwoSided: false,
      notes: "one-sided market",
    };
  }

  // Two-sided market - compute fair probabilities
  const fairProbs = fairProbAFromTwoSidedDecimal(sideA.odds, sideB.odds);

  const oddsTicks: NormalizedOddsTick[] = [
    {
      side: "A",
      oddsDecimal: sideA.odds,
      impliedProbRaw: fairProbs.pA_raw,
    },
    {
      side: "B",
      oddsDecimal: sideB.odds,
      impliedProbRaw: fairProbs.pB_raw,
    },
  ];

  return {
    marketName,
    externalEventId,
    observedAt: new Date(observedAt),
    selectionTeamAName: sideA.teamName,
    selectionTeamBName: sideB.teamName,
    oddsTicks,
    fairProbA: fairProbs.pA_fair,
    fairProbB: fairProbs.pB_fair,
    overround: fairProbs.overround,
    isTwoSided: true,
  };
}
