import { MatchState, WinProbResult } from "./types";

function sigmoid(z: number): number {
  // Clamp z to prevent exp overflow/underflow, but allow full sigmoid range
  const z_safe = Math.max(-100, Math.min(100, z));
  return 1 / (1 + Math.exp(-z_safe));
}

/**
 * V1: Calibrated logistic regression for T20 cricket
 * - Innings 2: uses required run rate, current run rate, wickets, balls remaining
 * - Innings 1: projects final score and maps to win probability
 * 
 * Logistic coefficients tuned for T20 context:
 * Higher RR => higher batting win%
 * Higher RRR => lower batting win%
 * More wickets remaining => higher batting win%
 * More balls remaining => higher batting win% (with same RRR)
 */
export function computeWinProbV1(state: MatchState): WinProbResult {
  const ballsTotal = 120;
  const ballsRemaining = ballsTotal - state.balls;

  const features: Record<string, number> = {
    ballsRemaining,
    wickets: state.wickets,
  };

  let battingWinProb = 0.5;

  if (state.innings === 2 && state.targetRuns) {
    // ===== Innings 2: Chase scenario =====
    const runsRemaining = Math.max(0, state.targetRuns - state.runs);

    if (runsRemaining <= 0) {
      battingWinProb = 1; // Target already reached
    } else if (ballsRemaining <= 0) {
      battingWinProb = 0; // No balls left, can't score more
    } else if (state.wickets >= 10) {
      battingWinProb = 0; // All out
    } else {
      const rr = state.balls > 0 ? (state.runs * 6) / state.balls : 0;
      const rrr = (runsRemaining * 6) / ballsRemaining;
      const wicketsInHand = Math.max(0, 10 - state.wickets);

      features.rr = rr;
      features.rrr = rrr;
      features.runsRemaining = runsRemaining;
      features.wicketsInHand = wicketsInHand;

      // Logistic model: p(batting win) = sigmoid(b0 + w1*rr + w2*rrr + w3*wickets + w4*ballsRemaining/120)
      // Coefficients calibrated for T20:
      // In T20, chasing a modest RRR (6-8) with wickets in hand is generally favorable
      const b0 = 0.3; // baseline favorable to batting team (chasing is possible in T20)
      const w_rr = 0.12; // higher current RR helps (each 1.0 rpo improvement)
      const w_rrr = -0.35; // higher RRR hurts (each 1.0 rpo more needed is bad)
      const w_wickets = 0.1; // each wicket in hand helps  
      const w_ballsRemaining = 0.08; // more balls remaining helps (per % of 120)

      const z =
        b0 +
        w_rr * rr +
        w_rrr * rrr +
        w_wickets * wicketsInHand +
        w_ballsRemaining * (ballsRemaining / ballsTotal);

      battingWinProb = sigmoid(z);
      // Apply confidence clipping for model output (not edge cases)
      if (battingWinProb < 0.01) battingWinProb = 0.01;
      if (battingWinProb > 0.99) battingWinProb = 0.99;
    }
  } else {
    // ===== Innings 1: No target, project score =====
    const wicketsInHand = Math.max(0, 10 - state.wickets);
    const crrIngs1 = state.balls > 0 ? (state.runs * 6) / state.balls : 5.5;

    // Wicket-adjusted future run rate: each wicket lost reduces expected future scoring
    const wicketDecayFactor = 1 - (10 - wicketsInHand) * 0.035;
    const projectedFutureRR = Math.max(3.5, crrIngs1 * wicketDecayFactor);
    const projectedRuns = state.runs + (ballsRemaining * projectedFutureRR) / 6;

    features.currentRR = crrIngs1;
    features.projectedScore = projectedRuns;
    features.projectedFutureRR = projectedFutureRR;

    // Phase-adjusted midline and scale: uncertainty narrows as the innings progresses
    const phaseFactor = state.balls / ballsTotal;
    const midline = 148 + 18 * phaseFactor; // ~148 at over 0, ~166 at over 20
    const scale = Math.max(8, 18 - 8 * phaseFactor); // tighter spread late in innings

    const z = (projectedRuns - midline) / scale;
    battingWinProb = sigmoid(z);
    if (battingWinProb < 0.01) battingWinProb = 0.01;
    if (battingWinProb > 0.99) battingWinProb = 0.99;
  }

  // Convert batting team win% to Team A win%
  const teamAWinProb = state.battingTeam === "A" ? battingWinProb : 1 - battingWinProb;

  return {
    winProb: teamAWinProb,
    modelVersion: "v1",
    features,
  };
}

