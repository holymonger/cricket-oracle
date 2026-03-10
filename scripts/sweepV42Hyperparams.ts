import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { FEATURE_NAMES_V42 } from "@/lib/features/featureSchemaV42";

type TrainingSample = {
  matchId: string;
  x: number[];
  y: number;
};

type HyperConfig = {
  l2: number;
  lr: number;
  epochs: number;
  useWeights: boolean;
};

type SweepResult = {
  config: HyperConfig;
  brier: number;
  logloss: number;
  accuracy: number;
  p05: number;
  p95: number;
  spreadWidth: number;
  trainTime: number;
};

const SEED = 42;
const TRAIN_FRAC = 0.8;
const EPS_STD = 1e-12;
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;
const BATCH_SIZE = 4096;
const CLIP_GRAD_NORM = 5;
const SKIP_PREFIXES = ["br_", "wih_", "p_", "rrd_"];

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
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffleInPlace<T>(arr: T[], seed: number): void {
  const rnd = seededRandom(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function extractFeatures(row: Record<string, unknown>): number[] {
  const featureSource =
    row.features && typeof row.features === "object"
      ? (row.features as Record<string, unknown>)
      : row;
  return FEATURE_NAMES_V42.map((name) => toNum(featureSource[name]));
}

async function loadSamples(filePath: string): Promise<TrainingSample[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`training file not found: ${filePath}`);
  }

  const samples: TrainingSample[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const matchId = String(row.matchId ?? row.matchKey ?? "");
      if (!matchId) continue;

      const yRaw = toNum(row.y);
      const y = yRaw >= 0.5 ? 1 : 0;
      const x = extractFeatures(row);
      samples.push({ matchId, x, y });
    } catch {
      continue;
    }
  }

  return samples;
}

function splitByMatch(samples: TrainingSample[]): {
  train: TrainingSample[];
  val: TrainingSample[];
} {
  const uniqueMatchIds = Array.from(new Set(samples.map((s) => s.matchId)));
  shuffleInPlace(uniqueMatchIds, SEED);

  const trainCount = Math.max(1, Math.floor(uniqueMatchIds.length * TRAIN_FRAC));
  const trainSet = new Set(uniqueMatchIds.slice(0, trainCount));

  const train = samples.filter((s) => trainSet.has(s.matchId));
  const val = samples.filter((s) => !trainSet.has(s.matchId));

  return { train, val };
}

function computeStandardization(
  train: TrainingSample[]
): { mean: number[]; std: number[] } {
  const dim = FEATURE_NAMES_V42.length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  const skipIdx = new Set<number>();

  for (let i = 0; i < FEATURE_NAMES_V42.length; i++) {
    if (SKIP_PREFIXES.some((prefix) => FEATURE_NAMES_V42[i].startsWith(prefix))) {
      skipIdx.add(i);
    }
  }

  for (const sample of train) {
    for (let i = 0; i < dim; i++) {
      if (skipIdx.has(i)) continue;
      mean[i] += sample.x[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    if (skipIdx.has(i)) {
      mean[i] = 0;
      continue;
    }
    mean[i] /= Math.max(1, train.length);
  }

  for (const sample of train) {
    for (let i = 0; i < dim; i++) {
      if (skipIdx.has(i)) continue;
      const d = sample.x[i] - mean[i];
      std[i] += d * d;
    }
  }

  for (let i = 0; i < dim; i++) {
    if (skipIdx.has(i)) {
      std[i] = 1;
      continue;
    }
    std[i] = Math.sqrt(std[i] / Math.max(1, train.length));
    if (std[i] < EPS_STD) std[i] = EPS_STD;
  }

  return { mean, std };
}

function applyStandardization(
  samples: TrainingSample[],
  mean: number[],
  std: number[]
): void {
  for (const sample of samples) {
    for (let i = 0; i < sample.x.length; i++) {
      sample.x[i] = (sample.x[i] - mean[i]) / std[i];
    }
  }
}

function buildSampleWeightFn(enabled: boolean): ((x: number[]) => number) | null {
  if (!enabled) return null;

  const idx = new Map<string, number>();
  for (let i = 0; i < FEATURE_NAMES_V42.length; i++) {
    idx.set(FEATURE_NAMES_V42[i], i);
  }

  const get = (x: number[], name: string) => {
    const i = idx.get(name);
    return i === undefined ? 0 : x[i];
  };

  return (x: number[]) => {
    let w = 1;
    if (get(x, "isChase") > 0.5) w *= 1.15;
    if (get(x, "br_0_6") > 0.5 || get(x, "br_7_12") > 0.5) w *= 1.35;
    if (get(x, "br_91_120") > 0.5) w *= 1.20;
    if (get(x, "p_2_0_2_5") > 0.5 || get(x, "p_2_5_3_0") > 0.5 || get(x, "p_3p") > 0.5) {
      w *= 1.25;
    }
    if (get(x, "rrd_-3p") > 0.5 || get(x, "rrd_3p") > 0.5) {
      w *= 1.20;
    }
    return Math.max(0.25, Math.min(4, w));
  };
}

function predictOne(intercept: number, coeff: number[], x: number[]): number {
  let z = intercept;
  for (let j = 0; j < coeff.length; j++) {
    z += coeff[j] * x[j];
  }
  return sigmoid(z);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const qq = Math.min(1, Math.max(0, q));
  const idx = qq * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function evaluate(
  samples: TrainingSample[],
  intercept: number,
  coeff: number[],
  l2: number
): { brier: number; logloss: number; accuracy: number; p05: number; p95: number } {
  let brier = 0;
  let logloss = 0;
  let correct = 0;
  const probs: number[] = [];

  for (const sample of samples) {
    const p = predictOne(intercept, coeff, sample.x);
    probs.push(p);

    const y = sample.y;
    const diff = p - y;
    brier += diff * diff;

    const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, p));
    logloss += -(y * Math.log(pSafe) + (1 - y) * Math.log(1 - pSafe));

    if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
  }

  const n = Math.max(1, samples.length);
  const sorted = [...probs].sort((a, b) => a - b);

  return {
    brier: brier / n,
    logloss: logloss / n,
    accuracy: correct / n,
    p05: quantile(sorted, 0.05),
    p95: quantile(sorted, 0.95),
  };
}

function makeIndexArray(n: number): number[] {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return idx;
}

function trainLogReg(
  train: TrainingSample[],
  val: TrainingSample[],
  config: HyperConfig,
  sampleWeightFn: ((x: number[]) => number) | null
): { brier: number; logloss: number; accuracy: number; p05: number; p95: number } {
  const dim = FEATURE_NAMES_V42.length;
  let intercept = 0;
  const coeff = new Array(dim).fill(0);

  let step = 0;
  let mB = 0;
  let vB = 0;
  const mW = new Array(dim).fill(0);
  const vW = new Array(dim).fill(0);

  for (let epoch = 1; epoch <= config.epochs; epoch++) {
    const indices = makeIndexArray(train.length);
    shuffleInPlace(indices, SEED + epoch * 31);

    for (let start = 0; start < indices.length; start += BATCH_SIZE) {
      const end = Math.min(indices.length, start + BATCH_SIZE);
      const batchN = Math.max(1, end - start);

      let gB = 0;
      const gW = new Array(dim).fill(0);

      for (let bi = start; bi < end; bi++) {
        const sample = train[indices[bi]];
        const p = predictOne(intercept, coeff, sample.x);
        const weight = sampleWeightFn ? sampleWeightFn(sample.x) : 1;
        const err = (p - sample.y) * weight;

        gB += err;
        for (let j = 0; j < dim; j++) {
          gW[j] += err * sample.x[j];
        }
      }

      gB /= batchN;
      for (let j = 0; j < dim; j++) {
        gW[j] = gW[j] / batchN + config.l2 * coeff[j];
      }

      let normSq = gB * gB;
      for (let j = 0; j < dim; j++) normSq += gW[j] * gW[j];
      const norm = Math.sqrt(normSq);
      if (norm > CLIP_GRAD_NORM) {
        const scale = CLIP_GRAD_NORM / Math.max(1e-12, norm);
        gB *= scale;
        for (let j = 0; j < dim; j++) gW[j] *= scale;
      }

      step += 1;
      mB = ADAM_BETA1 * mB + (1 - ADAM_BETA1) * gB;
      vB = ADAM_BETA2 * vB + (1 - ADAM_BETA2) * gB * gB;
      const mBHat = mB / (1 - Math.pow(ADAM_BETA1, step));
      const vBHat = vB / (1 - Math.pow(ADAM_BETA2, step));
      intercept -= config.lr * mBHat / (Math.sqrt(vBHat) + ADAM_EPS);

      for (let j = 0; j < dim; j++) {
        mW[j] = ADAM_BETA1 * mW[j] + (1 - ADAM_BETA1) * gW[j];
        vW[j] = ADAM_BETA2 * vW[j] + (1 - ADAM_BETA2) * gW[j] * gW[j];
        const mHat = mW[j] / (1 - Math.pow(ADAM_BETA1, step));
        const vHat = vW[j] / (1 - Math.pow(ADAM_BETA2, step));
        coeff[j] -= config.lr * mHat / (Math.sqrt(vHat) + ADAM_EPS);
      }
    }
  }

  return evaluate(val, intercept, coeff, config.l2);
}

async function runSweep(): Promise<SweepResult[]> {
  const dataPath = path.resolve(
    process.cwd(),
    "training/training_rows_v42_stratified.jsonl"
  );

  console.log("=== V4.2 Hyperparameter Sweep ===");
  console.log(`Data: ${dataPath}`);
  console.log("Loading samples...\n");

  const samples = await loadSamples(dataPath);
  if (samples.length < 100) {
    throw new Error(`not enough samples: ${samples.length}`);
  }

  const { train: trainRaw, val: valRaw } = splitByMatch(samples);
  console.log(`Train rows: ${trainRaw.length}, Val rows: ${valRaw.length}\n`);

  const { mean, std } = computeStandardization(trainRaw);

  const train = trainRaw.map((s) => ({ ...s, x: [...s.x] }));
  const val = valRaw.map((s) => ({ ...s, x: [...s.x] }));
  applyStandardization(train, mean, std);
  applyStandardization(val, mean, std);

  const configs: HyperConfig[] = [];
  const l2Values = [1e-9, 5e-9, 1e-8, 5e-8];
  const lrValues = [0.008, 0.01, 0.015];
  const epochsValues = [12, 15, 18];
  const useWeightsList = [true];

  for (const l2 of l2Values) {
    for (const lr of lrValues) {
      for (const epochs of epochsValues) {
        for (const useWeights of useWeightsList) {
          configs.push({ l2, lr, epochs, useWeights });
        }
      }
    }
  }

  console.log(`Running ${configs.length} configurations...\n`);

  const results: SweepResult[] = [];

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const sampleWeightFn = buildSampleWeightFn(config.useWeights);

    const startTime = Date.now();
    const metrics = trainLogReg(train, val, config, sampleWeightFn);
    const trainTime = (Date.now() - startTime) / 1000;

    const result: SweepResult = {
      config,
      brier: metrics.brier,
      logloss: metrics.logloss,
      accuracy: metrics.accuracy,
      p05: metrics.p05,
      p95: metrics.p95,
      spreadWidth: metrics.p95 - metrics.p05,
      trainTime,
    };

    results.push(result);

    console.log(
      `[${i + 1}/${configs.length}] l2=${config.l2.toExponential(1)} lr=${config.lr} epochs=${config.epochs} weights=${config.useWeights ? "Y" : "N"} | logloss=${result.logloss.toFixed(6)} spread=${result.spreadWidth.toFixed(4)} acc=${(result.accuracy * 100).toFixed(2)}% time=${trainTime.toFixed(1)}s`
    );
  }

  return results;
}

function saveResultsToCSV(results: SweepResult[], outputPath: string): void {
  const header = "l2,lr,epochs,useWeights,brier,logloss,accuracy,p05,p95,spreadWidth,trainTime\n";
  const rows = results.map((r) => {
    return [
      r.config.l2,
      r.config.lr,
      r.config.epochs,
      r.config.useWeights ? "true" : "false",
      r.brier.toFixed(6),
      r.logloss.toFixed(6),
      r.accuracy.toFixed(6),
      r.p05.toFixed(6),
      r.p95.toFixed(6),
      r.spreadWidth.toFixed(6),
      r.trainTime.toFixed(2),
    ].join(",");
  });

  fs.writeFileSync(outputPath, header + rows.join("\n"), "utf-8");
}

function findBestConfig(results: SweepResult[]): {
  bestByLogloss: SweepResult;
  bestBySpread: SweepResult;
  bestBalanced: SweepResult;
} {
  const sortedByLogloss = [...results].sort((a, b) => a.logloss - b.logloss);
  const sortedBySpread = [...results].sort((a, b) => b.spreadWidth - a.spreadWidth);

  const minSpread = 0.12;
  const balanced = results
    .filter((r) => r.spreadWidth >= minSpread)
    .sort((a, b) => a.logloss - b.logloss);

  return {
    bestByLogloss: sortedByLogloss[0],
    bestBySpread: sortedBySpread[0],
    bestBalanced: balanced.length > 0 ? balanced[0] : sortedByLogloss[0],
  };
}

function printSummary(results: SweepResult[]): void {
  const { bestByLogloss, bestBySpread, bestBalanced } = findBestConfig(results);

  console.log("\n=== Sweep Summary ===\n");

  console.log("Best by LogLoss:");
  console.log(
    `  l2=${bestByLogloss.config.l2.toExponential(1)} lr=${bestByLogloss.config.lr} epochs=${bestByLogloss.config.epochs} weights=${bestByLogloss.config.useWeights}`
  );
  console.log(
    `  logloss=${bestByLogloss.logloss.toFixed(6)} spread=${bestByLogloss.spreadWidth.toFixed(4)} acc=${(bestByLogloss.accuracy * 100).toFixed(2)}%`
  );

  console.log("\nBest by Spread Width:");
  console.log(
    `  l2=${bestBySpread.config.l2.toExponential(1)} lr=${bestBySpread.config.lr} epochs=${bestBySpread.config.epochs} weights=${bestBySpread.config.useWeights}`
  );
  console.log(
    `  logloss=${bestBySpread.logloss.toFixed(6)} spread=${bestBySpread.spreadWidth.toFixed(4)} acc=${(bestBySpread.accuracy * 100).toFixed(2)}%`
  );

  console.log("\nBest Balanced (spread >= 0.12, lowest logloss):");
  console.log(
    `  l2=${bestBalanced.config.l2.toExponential(1)} lr=${bestBalanced.config.lr} epochs=${bestBalanced.config.epochs} weights=${bestBalanced.config.useWeights}`
  );
  console.log(
    `  logloss=${bestBalanced.logloss.toFixed(6)} spread=${bestBalanced.spreadWidth.toFixed(4)} acc=${(bestBalanced.accuracy * 100).toFixed(2)}%`
  );

  console.log(
    `\nRecommendation: Use balanced config for production if spread acceptable, otherwise best-by-logloss.`
  );
}

async function main() {
  const results = await runSweep();

  const outputPath = path.resolve(
    process.cwd(),
    "reports",
    "v42_hyperparam_sweep.csv"
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  saveResultsToCSV(results, outputPath);

  console.log(`\nResults saved to: ${outputPath}`);

  printSummary(results);
}

main().catch((err) => {
  console.error("sweep:v42 failed:", err);
  process.exit(1);
});
