import { MatchState, WinProbResult } from "./types";
import { computeWinProbV0 } from "./v0";
import { computeWinProbV1 } from "./v1Logistic";

/**
 * Compute win probability (Team A win%) for a given match state.
 * 
 * @param state - Match state with innings, batting team, runs, wickets, balls, etc.
 * @param modelVersion - Model to use: "v0" or "v1". Defaults to "v1".
 * @returns WinProbResult with probability, model version, and features.
 */
export function computeWinProb(
  state: MatchState,
  modelVersion: "v0" | "v1" = "v1"
): WinProbResult {
  if (modelVersion === "v0") {
    return computeWinProbV0(state);
  } else if (modelVersion === "v1") {
    return computeWinProbV1(state);
  } else {
    throw new Error(`Unknown model version: ${modelVersion}`);
  }
}

export { computeWinProbV0 } from "./v0";
export { computeWinProbV1 } from "./v1Logistic";
export type { MatchState, WinProbResult } from "./types";
export type { BattingTeam } from "./types";
