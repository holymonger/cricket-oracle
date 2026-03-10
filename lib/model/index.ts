import { MatchState, WinProbResult } from "./types";
import { computeWinProbV0 } from "./v0";
import { computeWinProbV1 } from "./v1Logistic";
import { computeWinProbV3 } from "./v3Lgbm";
import { computeWinProbV4 } from "./v4Lgbm";
import { computeWinProbV4LogReg } from "./v4LogReg";
import { computeWinProbV41LogReg } from "./v41LogReg";
import { computeWinProbV42LogReg } from "./v42LogReg";
import { computeWinProbV43LogReg } from "./v43LogReg";
import { computeWinProbV5LightGBM } from "./v5LightGBM";

type ModelVersion = "v0" | "v1" | "v3-lgbm" | "v4-lgbm" | "v4-logreg" | "v41-logreg" | "v42-logreg" | "v43-logreg" | "v5-lgbm";

/**
 * Get the default model version from environment variables or hardcoded default.
 * 
 * Environment variable: DEFAULT_MODEL_VERSION
 * Defaults to "v1" if not set or invalid.
 */
function getDefaultModelVersion(): ModelVersion {
  const envDefault = process.env.DEFAULT_MODEL_VERSION;
  if (envDefault && ["v0", "v1", "v3-lgbm", "v4-lgbm", "v4-logreg", "v41-logreg", "v42-logreg", "v43-logreg", "v5-lgbm"].includes(envDefault)) {
    return envDefault as ModelVersion;
  }
  return "v1";
}

/**
 * Compute win probability (Team A win%) for a given match state.
 * 
 * @param state - Match state with innings, batting team, runs, wickets, balls, etc.
 * @param modelVersion - Model to use: "v0", "v1", "v3-lgbm", "v4-lgbm", "v4-logreg", "v41-logreg", "v42-logreg", or "v43-logreg".
 *   Defaults to value of DEFAULT_MODEL_VERSION env var or "v1".
 * @param features - Optional feature map for model inference
 * @returns WinProbResult with probability, model version, and features.
 */
export function computeWinProb(
  state: MatchState,
  modelVersion?: ModelVersion,
  features?: Record<string, number>
): WinProbResult {
  const version = modelVersion ?? getDefaultModelVersion();
  if (version === "v0") {
    return computeWinProbV0(state);
  } else if (version === "v1") {
    return computeWinProbV1(state);
  } else if (version === "v3-lgbm") {
    return computeWinProbV3(state, features);
  } else if (version === "v4-lgbm") {
    return computeWinProbV4(state, features);
  } else if (version === "v4-logreg") {
    return computeWinProbV4LogReg(state, features);
  } else if (version === "v41-logreg") {
    return computeWinProbV41LogReg(state, features);
  } else if (version === "v42-logreg") {
    return computeWinProbV42LogReg(state, features);
  } else if (version === "v43-logreg") {
    return computeWinProbV43LogReg(state, features);
  } else if (version === "v5-lgbm") {
    return computeWinProbV5LightGBM(state, features);
  } else {
    throw new Error(`Unknown model version: ${version}`);
  }
}

export { computeWinProbV0 } from "./v0";
export { computeWinProbV1 } from "./v1Logistic";
export { computeWinProbV3 } from "./v3Lgbm";
export { computeWinProbV4 } from "./v4Lgbm";
export { computeWinProbV4LogReg } from "./v4LogReg";
export { computeWinProbV41LogReg } from "./v41LogReg";
export { computeWinProbV42LogReg } from "./v42LogReg";
export { computeWinProbV43LogReg } from "./v43LogReg";
export { computeWinProbV5LightGBM } from "./v5LightGBM";
export type { MatchState, WinProbResult } from "./types";
export type { BattingTeam } from "./types";
export { getDefaultModelVersion };
