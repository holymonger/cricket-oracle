import { MatchState, WinProbResult } from "./types";
import { computeWinProbV3 } from "./v3Lgbm";

/**
 * V4 scaffold: currently reuses v3-lgbm computation until a dedicated
 * v4 model artifact is trained and integrated.
 */
export function computeWinProbV4(
  state: MatchState,
  features?: Record<string, number>
): WinProbResult {
  const base = computeWinProbV3(state, features);
  return {
    ...base,
    modelVersion: "v4-lgbm",
  };
}
