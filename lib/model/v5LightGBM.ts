/**
 * v5-lgbm: LightGBM gradient boosted tree model.
 *
 * Trained on the same v43 feature set (64 features) but uses gradient boosted
 * trees instead of logistic regression. Expected Brier ~0.19–0.21 vs 0.25 for
 * logistic regression on the same data.
 *
 * Requires running: python scripts/trainLightGBM.py
 * (needs Python + pip install lightgbm numpy scikit-learn)
 */

import * as fs from "fs";
import * as path from "path";
import type { MatchState, WinProbResult } from "./types";
import { type LGBMArtifact, predictLGBM, buildFeatureVector } from "./lgbmInference";

let cachedArtifact: LGBMArtifact | null = null;

function resolveArtifactPath(): string {
  const filename = "v5_lgbm.json";
  const candidates = [
    path.join(__dirname, "artifacts", filename),
    path.join(process.cwd(), "lib", "model", "artifacts", filename),
    path.resolve(__dirname, "..", "..", "lib", "model", "artifacts", filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function loadArtifact(): LGBMArtifact {
  if (cachedArtifact) return cachedArtifact;

  const artifactPath = resolveArtifactPath();
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `v5-lgbm artifact not found at ${artifactPath}.\n` +
      `Run: pip install lightgbm numpy scikit-learn && python scripts/trainLightGBM.py`
    );
  }

  const raw = fs.readFileSync(artifactPath, "utf-8");
  const parsed = JSON.parse(raw) as LGBMArtifact;

  if (parsed.modelVersion !== "v5-lgbm") {
    throw new Error(`invalid artifact modelVersion: ${parsed.modelVersion}`);
  }
  if (!Array.isArray(parsed.trees) || parsed.trees.length === 0) {
    throw new Error("v5-lgbm artifact has no trees");
  }

  cachedArtifact = parsed;
  return parsed;
}

/** Same feature extraction as v43 — model trained on these exact features */
function buildFeatures(state: MatchState): Record<string, number> {
  const balls = state.balls;
  const ballsRemaining = Math.max(0, 120 - balls);
  const runs = state.runs;
  const wickets = state.wickets;
  const targetRuns = state.targetRuns ?? 0;

  const rr = balls > 0 ? (runs * 6) / balls : 0;
  const isChase = state.innings === 2 ? 1 : 0;
  const runsNeeded = isChase ? Math.max(0, targetRuns - runs) : 0;
  const rrr = isChase && ballsRemaining > 0 ? (runsNeeded * 6) / ballsRemaining : 0;

  const wicketsInHand = Math.max(0, 10 - wickets);
  const isPowerplay = balls <= 36 ? 1 : 0;
  const isDeath = balls > 90 ? 1 : 0;
  const rrDelta = isChase ? rrr - rr : 0;
  const ballsRemainingFrac = ballsRemaining / 120;
  const chase = isChase === 1;

  const pressure = isChase && ballsRemaining > 0 ? runsNeeded / ballsRemaining : 0;
  const pressureSq = pressure * pressure;
  const rrDeltaSq = rrDelta * rrDelta;
  const wicketsInHandSq = wicketsInHand * wicketsInHand;

  const br = Math.max(0, Math.min(120, Math.round(ballsRemaining)));
  const wih = Math.max(0, Math.min(10, Math.round(wicketsInHand)));

  return {
    runs, wickets, balls, ballsRemaining, rr,
    targetRuns, runsNeeded, rrr,
    runsLast6: 0, wktsLast6: 0, dotsLast6: 0, boundariesLast6: 0,
    runsLast12: 0, wktsLast12: 0, dotsLast12: 0, boundariesLast12: 0,
    runsThisBallTotal: 0, isWicketThisBall: 0, isBoundaryThisBall: 0,
    isChase, isPowerplay, isDeath, wicketsInHand, rrDelta,
    rrLast12: 0, dotRateLast12: 0, boundaryRateLast12: 0, ballsRemainingFrac,
    rrDeltaSq, wicketsInHandSq,
    rrDelta_isDeath: rrDelta * isDeath,
    rrDelta_isPowerplay: rrDelta * isPowerplay,
    pressure, pressureSq,
    pressure_wkts: pressure * wicketsInHand,
    momentumGap: 0, momentumGap_isDeath: 0,
    br_0_6: br <= 6 ? 1 : 0,
    br_7_12: br >= 7 && br <= 12 ? 1 : 0,
    br_13_18: br >= 13 && br <= 18 ? 1 : 0,
    br_19_24: br >= 19 && br <= 24 ? 1 : 0,
    br_25_36: br >= 25 && br <= 36 ? 1 : 0,
    br_37_60: br >= 37 && br <= 60 ? 1 : 0,
    br_61_90: br >= 61 && br <= 90 ? 1 : 0,
    br_91_120: br >= 91 ? 1 : 0,
    wih_0_2: wih <= 2 ? 1 : 0,
    wih_3_5: wih >= 3 && wih <= 5 ? 1 : 0,
    wih_6_8: wih >= 6 && wih <= 8 ? 1 : 0,
    wih_9_10: wih >= 9 ? 1 : 0,
    p_0_0_5: chase && pressure < 0.5 ? 1 : 0,
    p_0_5_1_0: chase && pressure >= 0.5 && pressure < 1.0 ? 1 : 0,
    p_1_0_1_5: chase && pressure >= 1.0 && pressure < 1.5 ? 1 : 0,
    p_1_5_2_0: chase && pressure >= 1.5 && pressure < 2.0 ? 1 : 0,
    p_2_0_2_5: chase && pressure >= 2.0 && pressure < 2.5 ? 1 : 0,
    p_2_5_3_0: chase && pressure >= 2.5 && pressure < 3.0 ? 1 : 0,
    p_3p: chase && pressure >= 3.0 ? 1 : 0,
    "rrd_-3p": chase && rrDelta <= -3.0 ? 1 : 0,
    "rrd_-2_-3": chase && rrDelta > -3.0 && rrDelta <= -2.0 ? 1 : 0,
    "rrd_-1_-2": chase && rrDelta > -2.0 && rrDelta <= -1.0 ? 1 : 0,
    "rrd_-0_5_0_5": chase && rrDelta > -1.0 && rrDelta <= 0.5 ? 1 : 0,
    rrd_1_0_5_1_5: chase && rrDelta > 0.5 && rrDelta <= 1.5 ? 1 : 0,
    rrd_2_1_5_2_5: chase && rrDelta > 1.5 && rrDelta <= 2.5 ? 1 : 0,
    rrd_3p: chase && rrDelta > 2.5 ? 1 : 0,
    battingTeamIsA: state.battingTeam === "A" ? 1 : 0,
  };
}

export function computeWinProbV5LightGBM(
  state: MatchState,
  features?: Record<string, number>
): WinProbResult {
  const artifact = loadArtifact();
  const featureMap = features ?? buildFeatures(state);
  const featureVec = buildFeatureVector(artifact, featureMap);

  // Model is trained with label = "batting team wins"
  const battingTeamWinProb = predictLGBM(artifact, featureVec);

  // Convert to "Team A wins"
  const winProb = state.battingTeam === "B"
    ? 1 - battingTeamWinProb
    : battingTeamWinProb;

  return {
    winProb,
    modelVersion: "v5-lgbm",
    features: featureMap,
  };
}
