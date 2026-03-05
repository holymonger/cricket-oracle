import { MatchState, WinProbResult } from "./types";
import { computeWinProbV0 } from "./v0";
import { computeWinProbV1 } from "./v1Logistic";
import { computeWinProbV3 } from "./v3Lgbm";

/**
 * Compute win probability (Team A win%) for a given match state.
 * 
 * @param state - Match state with innings, batting team, runs, wickets, balls, etc.
 * @param modelVersion - Model to use: "v0", "v1", or "v3-lgbm". Defaults to "v1".
 * @param features - Optional feature map for v3-lgbm (per-ball features)
 * @returns WinProbResult with probability, model version, and features.
 */
export function computeWinProb(
  state: MatchState,
  modelVersion: "v0" | "v1" | "v3-lgbm" = "v1",
  features?: Record<string, number>
): WinProbResult {
  if (modelVersion === "v0") {
    return computeWinProbV0(state);
  } else if (modelVersion === "v1") {
    return computeWinProbV1(state);
  } else if (modelVersion === "v3-lgbm") {
    return computeWinProbV3(state, features);
  } else {
    throw new Error(`Unknown model version: ${modelVersion}`);
  }
}

export { computeWinProbV0 } from "./v0";
export { computeWinProbV1 } from "./v1Logistic";
export { computeWinProbV3 } from "./v3Lgbm";
export type { MatchState, WinProbResult } from "./types";
export type { BattingTeam } from "./types";
