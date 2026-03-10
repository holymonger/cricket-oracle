import { MatchState, WinProbResult } from "./types";
import { calibrateProb } from "./calibration";

/**
 * V3: LightGBM model for per-ball predictions
 * 
 * This is a stub that will eventually load a trained LightGBM model.
 * For now, it uses a heuristic similar to v1 but optimized for per-ball features.
 * 
 * Expected to improve accuracy over v0/v1 through:
 * - Rolling window features (last 6/12 balls)
 * - Player-level statistics
 * - Boundary frequency
 * - Dot ball patterns
 * 
 * Note: Output probabilities are automatically calibrated using the trained
 * calibration artifact (if available).
 */
export function computeWinProbV3(
  state: MatchState,
  features?: Record<string, number>
): WinProbResult {
  const ballsTotal = 120;
  const ballsRemaining = ballsTotal - state.balls;

  const featureMap: Record<string, number> = features || {
    ballsRemaining,
    wickets: state.wickets,
  };

  let battingWinProb = 0.5;

  if (state.innings === 2 && state.targetRuns) {
    // ===== Innings 2: Chase scenario =====
    const runsRemaining = Math.max(0, state.targetRuns - state.runs);

    if (runsRemaining <= 0) {
      battingWinProb = 1;
    } else if (ballsRemaining <= 0) {
      battingWinProb = 0;
    } else if (state.wickets >= 10) {
      battingWinProb = 0;
    } else {
      // V3: Use per-ball features if provided
      const rr = state.balls > 0 ? (state.runs * 6) / state.balls : 0;
      const rrr = (runsRemaining * 6) / ballsRemaining;
      const wicketsInHand = Math.max(0, 10 - state.wickets);

      // V3-specific: Use rolling window stats if available
      const runsLast6 = featureMap["runsLast6"] ?? 0;
      const wktsLast6 = featureMap["wktsLast6"] ?? 0;
      const boundariesLast6 = featureMap["boundariesLast6"] ?? 0;

      featureMap.rr = rr;
      featureMap.rrr = rrr;
      featureMap.wicketsInHand = wicketsInHand;
      featureMap.runsRemaining = runsRemaining;

      // V3 coefficients (optimized for per-ball context)
      const b0 = 0.35;
      const w_rr = 0.14;
      const w_rrr = -0.38;
      const w_wickets = 0.12;
      const w_ballsRemaining = 0.09;
      const w_boundariesLast6 = 0.05; // V3: Momentum indicator
      const w_runsLast6 = 0.03; // V3: Recent form

      const z =
        b0 +
        w_rr * rr +
        w_rrr * rrr +
        w_wickets * wicketsInHand +
        w_ballsRemaining * (ballsRemaining / ballsTotal) +
        w_boundariesLast6 * boundariesLast6 +
        w_runsLast6 * runsLast6;

      battingWinProb = sigmoid(z);

      if (battingWinProb < 0.01) battingWinProb = 0.01;
      if (battingWinProb > 0.99) battingWinProb = 0.99;
    }
  } else {
    // ===== Innings 1: Project score =====
    const ballsRemaining = Math.max(0, ballsTotal - state.balls);
    const crrIngs1 = state.balls > 0 ? (state.runs * 6) / state.balls : 5.0;

    // V3: Use recent run rate if available
    const runsLast6 = featureMap["runsLast6"] ?? 0;
    const recentRr = runsLast6; // Proxy for momentum

    featureMap.currentRR = crrIngs1;
    featureMap.recentMomentum = recentRr;

    // Project final score with momentum adjustment
    const momFactor = 1.0 + (recentRr - 5) * 0.05; // Adjust projection by recent form
    const projectedRuns =
      state.runs + (ballsRemaining * crrIngs1 * momFactor) / 6;

    featureMap.projectedScore = projectedRuns;

    // V3: Adjusted midline based on recent form
    const midline = 160;
    const scale = 20;
    const z = (projectedRuns - midline) / scale;
    battingWinProb = sigmoid(z);
  }

  // Convert batting team win% to Team A win%
  const rawTeamAWinProb =
    state.battingTeam === "A" ? battingWinProb : 1 - battingWinProb;

  // Apply calibration (if artifact exists)
  const calibratedTeamAWinProb = calibrateProb(rawTeamAWinProb, "v3-lgbm");

  return {
    winProb: calibratedTeamAWinProb,
    modelVersion: "v3-lgbm",
    features: featureMap,
  };
}

function sigmoid(z: number): number {
  // Clamp z to prevent overflow
  const maxZ = 100;
  const clampedZ = Math.max(-maxZ, Math.min(maxZ, z));
  return 1 / (1 + Math.exp(-clampedZ));
}
