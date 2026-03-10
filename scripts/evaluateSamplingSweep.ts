import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { FEATURE_NAMES_V4 } from "@/lib/features/featureSchemaV4";

type Sample = {
  matchId: string;
  legalBallNumber: number;
  x: number[];
  y: number;
};

type Metrics = {
  logloss: number;
  brier: number;
  accuracy: number;
  n: number;
};

type SweepResult = {
  sampleEveryBalls: number;
  trainRows: number;
  metrics: Metrics;
};

const SEED = 42;
const TRAIN_FRAC = 0.8;
const L2_LAMBDA = 1e-4;
const LR = Number(process.env.LOGREG_LR ?? "0.05");
const ITER = Number(process.env.LOGREG_ITERS ?? "1200");
const EPS_STD = 1e-12;

function toNum(v: unknown): number {
  const n = Number(v);
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
  const raw = idx >= 0 ? args[idx + 1] : fallback;
  return path.resolve(process.cwd(), raw);
}

function parseSampleList(): number[] {
  const args = process.argv.slice(2);
  const idx = args.findIndex((arg) => arg === "--samples");
  const raw = idx >= 0 ? args[idx + 1] : "1,3,6";
  const list = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .map((n) => Math.floor(n));

  if (list.length === 0) {
    throw new Error("--samples must include at least one positive integer");
  }
  return Array.from(new Set(list)).sort((a, b) => a - b);
}

function extractFeatures(row: Record<string, unknown>): number[] {
  const source =
    row.features && typeof row.features === "object"
      ? (row.features as Record<string, unknown>)
      : row;
  return FEATURE_NAMES_V4.map((name) => toNum(source[name]));
}

async function loadSamples(filePath: string): Promise<Sample[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`training file not found: ${filePath}`);
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
      const legalBallNumber = Math.max(1, Math.floor(toNum(row.legalBallNumber ?? 1)));
      const y = toNum(row.y) >= 0.5 ? 1 : 0;
      if (!matchId) continue;

      samples.push({
        matchId,
        legalBallNumber,
        x: extractFeatures(row),
        y,
      });
    } catch {
      continue;
    }
  }

  return samples;
}

function splitByMatch(samples: Sample[]): { trainMatches: Set<string>; holdoutMatches: Set<string> } {
  const matchIds = Array.from(new Set(samples.map((s) => s.matchId)));
  shuffleInPlace(matchIds, SEED);
  const trainCount = Math.max(1, Math.floor(matchIds.length * TRAIN_FRAC));
  return {
    trainMatches: new Set(matchIds.slice(0, trainCount)),
    holdoutMatches: new Set(matchIds.slice(trainCount)),
  };
}

function computeStandardization(train: Sample[]): { mean: number[]; std: number[] } {
  const dim = FEATURE_NAMES_V4.length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(1);

  for (const sample of train) {
    for (let i = 0; i < dim; i++) mean[i] += sample.x[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= Math.max(1, train.length);

  for (const sample of train) {
    for (let i = 0; i < dim; i++) {
      const d = sample.x[i] - mean[i];
      std[i] += d * d;
    }
  }

  for (let i = 0; i < dim; i++) {
    std[i] = Math.sqrt(std[i] / Math.max(1, train.length));
    if (std[i] < EPS_STD) std[i] = EPS_STD;
  }

  return { mean, std };
}

function applyStandardization(samples: Sample[], mean: number[], std: number[]): void {
  for (const sample of samples) {
    for (let i = 0; i < sample.x.length; i++) {
      sample.x[i] = (sample.x[i] - mean[i]) / std[i];
    }
  }
}

function trainLogReg(train: Sample[]): { intercept: number; coeff: number[] } {
  const dim = FEATURE_NAMES_V4.length;
  const w = new Array(dim + 1).fill(0);

  for (let iter = 1; iter <= ITER; iter++) {
    const grad = new Array(dim + 1).fill(0);

    for (const sample of train) {
      let z = w[0];
      for (let i = 0; i < dim; i++) z += w[i + 1] * sample.x[i];
      const p = sigmoid(z);
      const err = p - sample.y;
      grad[0] += err;
      for (let i = 0; i < dim; i++) grad[i + 1] += err * sample.x[i];
    }

    const n = Math.max(1, train.length);
    grad[0] /= n;
    for (let i = 1; i <= dim; i++) {
      grad[i] = grad[i] / n + L2_LAMBDA * w[i];
    }

    w[0] -= LR * grad[0];
    for (let i = 1; i <= dim; i++) {
      w[i] -= LR * grad[i];
    }
  }

  return { intercept: w[0], coeff: w.slice(1) };
}

function predict(intercept: number, coeff: number[], x: number[]): number {
  let z = intercept;
  for (let i = 0; i < coeff.length; i++) z += coeff[i] * x[i];
  return sigmoid(z);
}

function evaluate(holdout: Sample[], intercept: number, coeff: number[]): Metrics {
  let brier = 0;
  let logloss = 0;
  let correct = 0;

  for (const sample of holdout) {
    const p = predict(intercept, coeff, sample.x);
    const diff = p - sample.y;
    brier += diff * diff;
    const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, p));
    logloss += -(sample.y * Math.log(pSafe) + (1 - sample.y) * Math.log(1 - pSafe));
    if ((p >= 0.5 ? 1 : 0) === sample.y) correct += 1;
  }

  const n = Math.max(1, holdout.length);
  return {
    logloss: logloss / n,
    brier: brier / n,
    accuracy: correct / n,
    n: holdout.length,
  };
}

function trainAndScore(trainRaw: Sample[], holdoutRaw: Sample[]): Metrics {
  const train = trainRaw.map((s) => ({ ...s, x: [...s.x] }));
  const holdout = holdoutRaw.map((s) => ({ ...s, x: [...s.x] }));

  const { mean, std } = computeStandardization(train);
  applyStandardization(train, mean, std);
  applyStandardization(holdout, mean, std);

  const { intercept, coeff } = trainLogReg(train);
  return evaluate(holdout, intercept, coeff);
}

function printTable(results: SweepResult[]): void {
  console.log("\n--- Sampling Sweep (shared holdout) ---");
  console.log("sampleEveryBalls  trainRows  logloss   brier     acc");
  console.log("------------------------------------------------------");
  for (const row of results) {
    const accPct = `${(row.metrics.accuracy * 100).toFixed(2)}%`;
    console.log(
      `${row.sampleEveryBalls.toString().padEnd(16)} ${row.trainRows
        .toString()
        .padEnd(9)} ${row.metrics.logloss.toFixed(6).padEnd(9)} ${row.metrics.brier
        .toFixed(6)
        .padEnd(9)} ${accPct}`
    );
  }

  const best = [...results].sort((a, b) => a.metrics.logloss - b.metrics.logloss)[0];
  console.log(`\nbest_by_logloss: sampleEveryBalls=${best.sampleEveryBalls}`);
}

async function main() {
  const dataPath = parseArgValue("--data", "training/training_rows_v4.jsonl");
  const sampleValues = parseSampleList();

  console.log("=== Evaluate V4 Sampling Sweep ===");
  console.log(`data: ${dataPath}`);
  console.log(`samples: ${sampleValues.join(",")}`);

  const all = await loadSamples(dataPath);
  if (all.length < 1000) {
    throw new Error(`Not enough samples loaded: ${all.length}`);
  }

  const { trainMatches, holdoutMatches } = splitByMatch(all);
  const fullTrain = all.filter((s) => trainMatches.has(s.matchId));
  const holdout = all.filter((s) => holdoutMatches.has(s.matchId));

  console.log(`rows loaded: ${all.length}`);
  console.log(`train rows (full): ${fullTrain.length}`);
  console.log(`holdout rows: ${holdout.length}`);

  const results: SweepResult[] = [];
  for (const k of sampleValues) {
    const sampledTrain =
      k <= 1 ? fullTrain : fullTrain.filter((s) => s.legalBallNumber % k === 0);

    if (sampledTrain.length < 100) {
      console.log(`sampleEveryBalls=${k} skipped (too few rows: ${sampledTrain.length})`);
      continue;
    }

    const metrics = trainAndScore(sampledTrain, holdout);
    results.push({ sampleEveryBalls: k, trainRows: sampledTrain.length, metrics });
  }

  if (results.length === 0) {
    throw new Error("No valid sweep results produced.");
  }

  printTable(results);
}

main().catch((err) => {
  console.error("eval sampling sweep failed:", err);
  process.exit(1);
});
