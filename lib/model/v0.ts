import { MatchState, WinProbResult } from "./types";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * V0: Hand-tuned logistic regression for chase scenarios (innings 2 with target).
 * For innings 1, returns neutral 0.5.
 * 
 * Note: This returns batting team win%, which is then converted to Team A win%
 * based on state.battingTeam.
 */
export function computeWinProbV0(state: MatchState): WinProbResult {
  const ballsTotal = 120;
  const ballsRemaining = ballsTotal - state.balls;

  // Features map
  const features: Record<string, number> = {
    ballsRemaining,
    wickets: state.wickets,
  };

  let battingWinProb = 0.5;

  if (state.innings === 2 && state.targetRuns) {
    // Innings 2: chase scenario
    const runsRemaining = state.targetRuns - state.runs;

    if (runsRemaining <= 0) {
      battingWinProb = 1;
    } else if (ballsRemaining <= 0) {
      battingWinProb = 0;
    } else if (state.wickets >= 10) {
      battingWinProb = 0;
    } else {
      const reqRr = (runsRemaining * 6) / ballsRemaining;
      const curRr = state.balls > 0 ? (state.runs * 6) / state.balls : 0;
      const wicketsInHand = 10 - state.wickets;

      features.runsRemaining = runsRemaining;
      features.reqRr = reqRr;
      features.curRr = curRr;
      features.wicketsInHand = wicketsInHand;

      // Hand-tuned logistic model
      const x = 0.9 * (curRr - reqRr) + 0.12 * wicketsInHand + 0.004 * ballsRemaining;
      battingWinProb = clamp01(1 / (1 + Math.exp(-x)));
    }
  } else {
    // Innings 1: no target, use neutral 0.5
    battingWinProb = 0.5;
  }

  // Convert batting team win% to Team A win%
  const teamAWinProb = state.battingTeam === "A" ? battingWinProb : 1 - battingWinProb;

  return {
    winProb: clamp01(teamAWinProb),
    modelVersion: "v0",
    features,
  };
}
