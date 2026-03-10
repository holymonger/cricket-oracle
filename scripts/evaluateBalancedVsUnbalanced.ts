import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { FEATURE_NAMES_V4 } from "@/lib/features/featureSchemaV4";

type Sample = {
  matchId: string;
  x: number[];
  y: number;
};

type TrainResult = {
  mean: number[];
  std: number[];
  intercept: number;
  coeff: number[];
};

type Metrics = {
  brier: number;
  logloss: number;
  accuracy: number;
  count: number;
};

const SEED = 42;
const TRAIN_FRAC = 0.8;
const L2_LAMBDA = 1e-4;
const LR = Number(process.env.LOGREG_LR ?? "0.05");
const ITER = Number(process.env.LOGREG_ITERS ?? "1200");
const EPS_STD = 1e-12;

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace<T>(arr: T[], seed: number): void {
  const rnd = seededRandom(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function parseArgValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const idx = args.findIndex((arg) => arg === name);
  const raw = idx >= 0 ? args[idx + 1] : undefined;
  return path.resolve(process.cwd(), raw ?? fallback);
}

function extractVector(row: Record<string, unknown>): number[] {
  const features =
    row.features && typeof row.features === "object"
      ? (row.features as Record<string, unknown>)
      : row;
  return FEATURE_NAMES_V4.map((f) => toNum(features[f]));
}

async function loadSamples(filePath: string): Promise<Sample[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const samples: Sample[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const matchId = String(row.matchId ?? row.matchKey ?? "");
      if (!matchId) continue;
      const y = toNum(row.y) >= 0.5 ? 1 : 0;
      samples.push({ matchId, x: extractVector(row), y });
    } catch {
      continue;
    }
  }

  return samples;
}

function splitMatches(samples: Sample[]): { trainMatches: Set<string>; holdoutMatches: Set<string> } {
  const matchIds = Array.from(new Set(samples.map((s) => s.matchId)));
  shuffleInPlace(matchIds, SEED);
  const trainCount = Math.max(1, Math.floor(matchIds.length * TRAIN_FRAC));
  const trainMatches = new Set(matchIds.slice(0, trainCount));
  const holdoutMatches = new Set(matchIds.slice(trainCount));
  return { trainMatches, holdoutMatches };
}

function computeStandardization(samples: Sample[]): { mean: number[]; std: number[] } {
  const dim = FEATURE_NAMES_V4.length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(1);

  for (const s of samples) {
    for (let i = 0; i < dim; i++) mean[i] += s.x[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= Math.max(1, samples.length);

  for (const s of samples) {
    for (let i = 0; i < dim; i++) {
      const d = s.x[i] - mean[i];
      std[i] += d * d;
    }
  }

  for (let i = 0; i < dim; i++) {
    std[i] = Math.sqrt(std[i] / Math.max(1, samples.length));
    if (std[i] < EPS_STD) std[i] = EPS_STD;
  }

  return { mean, std };
}

function applyStandardizationInPlace(samples: Sample[], mean: number[], std: number[]): void {
  for (const s of samples) {
    for (let i = 0; i < s.x.length; i++) {
      s.x[i] = (s.x[i] - mean[i]) / std[i];
    }
  }
}

function trainLogReg(train: Sample[]): { intercept: number; coeff: number[] } {
  const dim = FEATURE_NAMES_V4.length;
  const w = new Array(dim + 1).fill(0);

  for (let iter = 1; iter <= ITER; iter++) {
    const grad = new Array(dim + 1).fill(0);
    for (const s of train) {
      let z = w[0];
      for (let j = 0; j < dim; j++) z += w[j + 1] * s.x[j];
      const p = sigmoid(z);
      const err = p - s.y;
      grad[0] += err;
      for (let j = 0; j < dim; j++) grad[j + 1] += err * s.x[j];
    }

    const n = Math.max(1, train.length);
    grad[0] /= n;
    for (let j = 1; j <= dim; j++) {
      grad[j] = grad[j] / n + L2_LAMBDA * w[j];
    }

    w[0] -= LR * grad[0];
    for (let j = 1; j <= dim; j++) w[j] -= LR * grad[j];
  }

  return { intercept: w[0], coeff: w.slice(1) };
}

function predictOne(model: { intercept: number; coeff: number[] }, x: number[]): number {
  let z = model.intercept;
  for (let i = 0; i < model.coeff.length; i++) z += model.coeff[i] * x[i];
  return sigmoid(z);
}

function evaluate(samples: Sample[], model: TrainResult): Metrics {
  let brier = 0;
  let logloss = 0;
  let correct = 0;

  for (const s of samples) {
    const p = predictOne(model, s.x);
    const diff = p - s.y;
    brier += diff * diff;

    const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, p));
    logloss += -(s.y * Math.log(pSafe) + (1 - s.y) * Math.log(1 - pSafe));
    if ((p >= 0.5 ? 1 : 0) === s.y) correct += 1;
  }

  const n = Math.max(1, samples.length);
  return {
    brier: brier / n,
    logloss: logloss / n,
    accuracy: correct / n,
    count: samples.length,
  };
}

function trainAndEvaluate(trainRaw: Sample[], holdoutRaw: Sample[]): Metrics {
  const train = trainRaw.map((s) => ({ ...s, x: [...s.x] }));
  const holdout = holdoutRaw.map((s) => ({ ...s, x: [...s.x] }));

  const { mean, std } = computeStandardization(train);
  applyStandardizationInPlace(train, mean, std);
  applyStandardizationInPlace(holdout, mean, std);

  const model = trainLogReg(train);
  return evaluate(holdout, { ...model, mean, std });
}

async function main() {
  const fullPath = parseArgValue("--full", "training/training_rows_v4.jsonl");
  const balancedPath = parseArgValue(
    "--balanced",
    "training/training_rows_v4_balanced_2000.jsonl"
  );

  console.log("=== Evaluate Balanced vs Unbalanced (shared holdout) ===");
  console.log(`full: ${fullPath}`);
  console.log(`balanced: ${balancedPath}`);

  const full = await loadSamples(fullPath);
  const balanced = await loadSamples(balancedPath);

  const { trainMatches, holdoutMatches } = splitMatches(full);
  const fullTrain = full.filter((s) => trainMatches.has(s.matchId));
  const holdout = full.filter((s) => holdoutMatches.has(s.matchId));

  const balancedTrain = balanced.filter((s) => trainMatches.has(s.matchId));

  console.log(`full rows: ${full.length}`);
  console.log(`balanced rows: ${balanced.length}`);
  console.log(`full train rows: ${fullTrain.length}`);
  console.log(`balanced train rows: ${balancedTrain.length}`);
  console.log(`holdout rows: ${holdout.length}`);

  if (fullTrain.length < 100 || balancedTrain.length < 100 || holdout.length < 100) {
    throw new Error("Not enough rows for robust comparison.");
  }

  const unbalancedMetrics = trainAndEvaluate(fullTrain, holdout);
  const balancedMetrics = trainAndEvaluate(balancedTrain, holdout);

  console.log("\n--- Holdout Metrics ---");
  console.log(
    `unbalanced | logloss=${unbalancedMetrics.logloss.toFixed(6)} brier=${unbalancedMetrics.brier.toFixed(6)} acc=${(unbalancedMetrics.accuracy * 100).toFixed(2)}% n=${unbalancedMetrics.count}`
  );
  console.log(
    `balanced   | logloss=${balancedMetrics.logloss.toFixed(6)} brier=${balancedMetrics.brier.toFixed(6)} acc=${(balancedMetrics.accuracy * 100).toFixed(2)}% n=${balancedMetrics.count}`
  );

  const winner =
    balancedMetrics.logloss < unbalancedMetrics.logloss ? "balanced" : "unbalanced";
  console.log(`winner_by_logloss: ${winner}`);
}

main().catch((err) => {
  console.error("eval balanced vs unbalanced failed:", err);
  process.exit(1);
});
