import * as fs from "fs";
import * as path from "path";
import type { MatchState, WinProbResult } from "./types";

type V43LogRegArtifact = {
  modelVersion: "v43-logreg";
  featureVersion?: "v43";
  trainedAt: string;
  featureNames: string[];
  standardize: boolean;
  mean: number[];
  std: number[];
  intercept: number;
  coeff: number[];
  metrics?: {
    brier: number;
    logloss: number;
    accuracy: number;
  };
  notes?: string;
};

let cachedArtifact: V43LogRegArtifact | null = null;

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function resolveArtifactPath(): string {
  const filename = "v43_logreg.json";
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

function loadArtifact(): V43LogRegArtifact {
  if (cachedArtifact) return cachedArtifact;

  const artifactPath = resolveArtifactPath();
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`v43-logreg artifact not found at ${artifactPath}. Run: npm run train:v43logreg`);
  }

  const raw = fs.readFileSync(artifactPath, "utf-8");
  const parsed = JSON.parse(raw) as V43LogRegArtifact;

  if (parsed.modelVersion !== "v43-logreg") {
    throw new Error(`invalid artifact modelVersion: ${parsed.modelVersion}`);
  }
  if (!Array.isArray(parsed.featureNames) || !Array.isArray(parsed.coeff)) {
    throw new Error("invalid v43-logreg artifact shape");
  }
  if (parsed.featureNames.length !== parsed.coeff.length) {
    throw new Error("artifact coeff length does not match featureNames length");
  }

  cachedArtifact = parsed;
  return parsed;
}

function vectorFromFeatureRow(featureRow: Record<string, number>, featureNames: string[]): number[] {
  return featureNames.map((name) => toNum(featureRow[name]));
}

export function predictFromFeaturesV43(featureRow: Record<string, number>): WinProbResult {
  const artifact = loadArtifact();
  const x = vectorFromFeatureRow(featureRow, artifact.featureNames);

  if (artifact.standardize) {
    for (let i = 0; i < x.length; i++) {
      const mean = toNum(artifact.mean?.[i]);
      const stdRaw = toNum(artifact.std?.[i]);
      const std = stdRaw > 1e-12 ? stdRaw : 1e-12;
      x[i] = (x[i] - mean) / std;
    }
  }

  let z = toNum(artifact.intercept);
  for (let i = 0; i < x.length; i++) {
    z += toNum(artifact.coeff[i]) * x[i];
  }

  const rawProb = sigmoid(z);
  return {
    winProb: rawProb,
    modelVersion: "v43-logreg",
    features: {
      ...featureRow,
      __rawProb: rawProb,
    },
  };
}

function buildFallbackFeatures(state: MatchState): Record<string, number> {
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

  const pressure = isChase && ballsRemaining > 0 ? runsNeeded / ballsRemaining : 0;
  const pressureSq = pressure * pressure;
  const rrDeltaSq = rrDelta * rrDelta;
  const wicketsInHandSq = wicketsInHand * wicketsInHand;

  const br = Math.max(0, Math.min(120, Math.round(ballsRemaining)));
  const wih = Math.max(0, Math.min(10, Math.round(wicketsInHand)));
  const chase = isChase === 1;

  return {
    runs,
    wickets,
    balls,
    ballsRemaining,
    rr,
    targetRuns,
    runsNeeded,
    rrr,
    // Rolling window features — unavailable from basic state, default to 0
    runsLast6: 0,
    wktsLast6: 0,
    dotsLast6: 0,
    boundariesLast6: 0,
    runsLast12: 0,
    wktsLast12: 0,
    dotsLast12: 0,
    boundariesLast12: 0,
    runsThisBallTotal: 0,
    isWicketThisBall: 0,
    isBoundaryThisBall: 0,
    // V4 features
    isChase,
    isPowerplay,
    isDeath,
    wicketsInHand,
    rrDelta,
    rrLast12: 0,
    dotRateLast12: 0,
    boundaryRateLast12: 0,
    ballsRemainingFrac,
    // V41 features
    rrDeltaSq,
    wicketsInHandSq,
    rrDelta_isDeath: rrDelta * isDeath,
    rrDelta_isPowerplay: rrDelta * isPowerplay,
    pressure,
    pressureSq,
    pressure_wkts: pressure * wicketsInHand,
    momentumGap: 0,
    momentumGap_isDeath: 0,
    // V42 band indicators — ballsRemaining
    br_0_6: br <= 6 ? 1 : 0,
    br_7_12: br >= 7 && br <= 12 ? 1 : 0,
    br_13_18: br >= 13 && br <= 18 ? 1 : 0,
    br_19_24: br >= 19 && br <= 24 ? 1 : 0,
    br_25_36: br >= 25 && br <= 36 ? 1 : 0,
    br_37_60: br >= 37 && br <= 60 ? 1 : 0,
    br_61_90: br >= 61 && br <= 90 ? 1 : 0,
    br_91_120: br >= 91 && br <= 120 ? 1 : 0,
    // V42 band indicators — wicketsInHand
    wih_0_2: wih <= 2 ? 1 : 0,
    wih_3_5: wih >= 3 && wih <= 5 ? 1 : 0,
    wih_6_8: wih >= 6 && wih <= 8 ? 1 : 0,
    wih_9_10: wih >= 9 ? 1 : 0,
    // V42 band indicators — pressure
    p_0_0_5: chase && pressure < 0.5 ? 1 : 0,
    p_0_5_1_0: chase && pressure >= 0.5 && pressure < 1.0 ? 1 : 0,
    p_1_0_1_5: chase && pressure >= 1.0 && pressure < 1.5 ? 1 : 0,
    p_1_5_2_0: chase && pressure >= 1.5 && pressure < 2.0 ? 1 : 0,
    p_2_0_2_5: chase && pressure >= 2.0 && pressure < 2.5 ? 1 : 0,
    p_2_5_3_0: chase && pressure >= 2.5 && pressure < 3.0 ? 1 : 0,
    p_3p: chase && pressure >= 3.0 ? 1 : 0,
    // V42 band indicators — rrDelta (rrr − rr; positive = behind)
    "rrd_-3p": chase && rrDelta <= -3.0 ? 1 : 0,
    "rrd_-2_-3": chase && rrDelta > -3.0 && rrDelta <= -2.0 ? 1 : 0,
    "rrd_-1_-2": chase && rrDelta > -2.0 && rrDelta <= -1.0 ? 1 : 0,
    "rrd_-0_5_0_5": chase && rrDelta > -1.0 && rrDelta <= 0.5 ? 1 : 0,
    rrd_1_0_5_1_5: chase && rrDelta > 0.5 && rrDelta <= 1.5 ? 1 : 0,
    rrd_2_1_5_2_5: chase && rrDelta > 1.5 && rrDelta <= 2.5 ? 1 : 0,
    rrd_3p: chase && rrDelta > 2.5 ? 1 : 0,
    // V43
    battingTeamIsA: state.battingTeam === "A" ? 1 : 0,
  };
}

export function computeWinProbV43LogReg(
  state: MatchState,
  features?: Record<string, number>
): WinProbResult {
  const featureRow = features ?? buildFallbackFeatures(state);
  const result = predictFromFeaturesV43(featureRow);

  // Model is trained with label = "batting team wins".
  // Convert to "Team A wins": if Team B is batting, flip the probability.
  const teamAWinProb =
    state.battingTeam === "B" ? 1 - result.winProb : result.winProb;

  return {
    ...result,
    winProb: teamAWinProb,
  };
}
