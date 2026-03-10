import * as fs from "fs";
import * as path from "path";
import type { WinProbResult, MatchState } from "./types";

type V4LogRegArtifact = {
  modelVersion: "v4-logreg";
  featureVersion?: "v4";
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

let cachedArtifact: V4LogRegArtifact | null = null;

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
  const filename = "v4_logreg.json";
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

function loadArtifact(): V4LogRegArtifact {
  if (cachedArtifact) return cachedArtifact;

  const artifactPath = resolveArtifactPath();
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`v4-logreg artifact not found at ${artifactPath}. Run: npm run train:v4logreg`);
  }

  const raw = fs.readFileSync(artifactPath, "utf-8");
  const parsed = JSON.parse(raw) as V4LogRegArtifact;

  if (parsed.modelVersion !== "v4-logreg") {
    throw new Error(`invalid artifact modelVersion: ${parsed.modelVersion}`);
  }
  if (!Array.isArray(parsed.featureNames) || !Array.isArray(parsed.coeff)) {
    throw new Error("invalid v4-logreg artifact shape");
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

export function predictFromFeaturesV4(featureRow: Record<string, number>): WinProbResult {
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

  const prob = sigmoid(z);
  return {
    winProb: prob,
    modelVersion: "v4-logreg",
    features: featureRow,
  };
}

export function computeWinProbV4LogReg(
  state: MatchState,
  features?: Record<string, number>
): WinProbResult {
  const fallbackFeatures: Record<string, number> = features || {
    runs: state.runs,
    wickets: state.wickets,
    balls: state.balls,
    ballsRemaining: Math.max(0, 120 - state.balls),
    rr: state.balls > 0 ? (state.runs * 6) / state.balls : 0,
    targetRuns: state.targetRuns ?? 0,
  };

  return predictFromFeaturesV4(fallbackFeatures);
}
