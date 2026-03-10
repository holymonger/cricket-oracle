import type { EdgeSignal, OddsTick } from "@prisma/client";

export interface StrategyEdgeV1Options {
  threshold?: number;
  defaultStake?: number;
  includeTeamB?: boolean;
  staleThresholdSeconds?: number;
}

export interface PaperBetCandidate {
  matchId: string;
  marketEventId: string;
  observedAt: Date;
  side: "A" | "B";
  stake: number;
  oddsDecimal: number;
  impliedProb?: number;
  modelProbA: number;
  marketProbA: number;
  edgeA: number;
  ruleVersion: "edge-v1";
}

export interface EvaluateSignalInput {
  edgeSignal: EdgeSignal;
  oddsA?: OddsTick | null;
  oddsB?: OddsTick | null;
  stake?: number;
  options?: StrategyEdgeV1Options;
}

const DEFAULTS: Required<StrategyEdgeV1Options> = {
  threshold: 0.03,
  defaultStake: 10,
  includeTeamB: false,
  staleThresholdSeconds: 10,
};

function isSignalStale(
  edgeSignal: EdgeSignal,
  staleThresholdSeconds: number
): boolean {
  if (edgeSignal.isStale) {
    return true;
  }

  if (edgeSignal.stalenessSeconds > staleThresholdSeconds) {
    return true;
  }

  const notes = (edgeSignal.notes || "").toLowerCase();
  return notes.includes("stale");
}

export function evaluateEdgeSignalForBet(
  input: EvaluateSignalInput
): PaperBetCandidate | null {
  const config = { ...DEFAULTS, ...(input.options || {}) };
  const { edgeSignal, oddsA, oddsB } = input;

  if (isSignalStale(edgeSignal, config.staleThresholdSeconds)) {
    return null;
  }

  if (Math.abs(edgeSignal.edgeA) < config.threshold) {
    return null;
  }

  let side: "A" | "B" = "A";

  if (edgeSignal.edgeA > 0) {
    side = "A";
  } else {
    if (!config.includeTeamB) {
      return null;
    }
    side = "B";
  }

  const chosenOdds = side === "A" ? oddsA : oddsB;
  if (!chosenOdds) {
    return null;
  }

  const stake = input.stake ?? config.defaultStake;
  if (!Number.isFinite(stake) || stake <= 0) {
    return null;
  }

  return {
    matchId: edgeSignal.matchId,
    marketEventId: edgeSignal.marketEventId,
    observedAt: chosenOdds.observedAt,
    side,
    stake,
    oddsDecimal: chosenOdds.oddsDecimal,
    impliedProb: chosenOdds.impliedProbRaw,
    modelProbA: edgeSignal.teamAWinProb,
    marketProbA: edgeSignal.marketProbA_fair,
    edgeA: edgeSignal.edgeA,
    ruleVersion: "edge-v1",
  };
}
