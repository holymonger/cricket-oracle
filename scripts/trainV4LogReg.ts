import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { FEATURE_NAMES_V4 } from "@/lib/features/featureSchemaV4";
import { FEATURE_NAMES_V41 } from "@/lib/features/featureSchemaV41";
import { FEATURE_NAMES_V42 } from "@/lib/features/featureSchemaV42";
import { FEATURE_NAMES_V43 } from "@/lib/features/featureSchemaV43";

type FeatureVersion = "v4" | "v41" | "v42" | "v43";
type Optimizer = "adam" | "sgd";

type TrainOptions = {
  dataPath: string;
  featureVersion: FeatureVersion;
  optimizer: Optimizer;
  lr: number;
  l2: number;
  epochs: number;
  batchSize: number;
  clipGradNorm: number;
  seed: number;
  useV42SampleWeights: boolean;
};

type TrainingSample = {
  matchId: string;
  x: number[];
  y: number;
};

type Metrics = {
  loss: number;
  brier: number;
  logloss: number;
  accuracy: number;
};

type Quantiles = {
  min: number;
  p01: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

type LogRegArtifact = {
  modelVersion: "v4-logreg" | "v41-logreg" | "v42-logreg" | "v43-logreg";
  featureVersion: FeatureVersion;
  trainedAt: string;
  featureNames: string[];
  standardize: boolean;
  mean: number[];
  std: number[];
  intercept: number;
  coeff: number[];
  metrics: {
    brier: number;
    logloss: number;
    accuracy: number;
  };
  notes: string;
  skipStandardizationPrefixes?: string[];
};

const SEED = 42;
const TRAIN_FRAC = 0.8;
const EPS_STD = 1e-12;
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;

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

function parseArg(args: string[], name: string): string | undefined {
  const idx = args.findIndex((a) => a === name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function parseFeatureVersion(raw: string | undefined): FeatureVersion {
  const value = (raw ?? "v4").toLowerCase();
  if (value === "v4" || value === "v41" || value === "v42" || value === "v43") return value;
  throw new Error(`Invalid --featureVersion value: ${value}. Expected v4, v41, v42, or v43`);
}

function parseOptimizer(raw: string | undefined): Optimizer {
  const value = (raw ?? "adam").toLowerCase();
  if (value === "adam" || value === "sgd") return value;
  throw new Error(`Invalid --optimizer value: ${value}. Expected adam or sgd`);
}

function parseOptions(): TrainOptions {
  const args = process.argv.slice(2);

  const featureVersion = parseFeatureVersion(parseArg(args, "--featureVersion"));
  const optimizer = parseOptimizer(parseArg(args, "--optimizer"));

  const dataDefault =
    featureVersion === "v43"
      ? "training/training_rows_v43_stratified.jsonl"
      : featureVersion === "v42"
      ? "training/training_rows_v42_stratified.jsonl"
      : featureVersion === "v41"
      ? "training/training_rows_v41.jsonl"
      : "training/training_rows_v4.jsonl";
  const dataPath = path.resolve(process.cwd(), parseArg(args, "--data") ?? dataDefault);

  const lrDefault = optimizer === "adam" ? 0.01 : 0.01;
  const l2Default = featureVersion === "v42" || featureVersion === "v43" ? "1e-8" : "1e-6";
  const epochsDefault = featureVersion === "v42" || featureVersion === "v43" ? "12" : "5";

  const lr = Number(parseArg(args, "--lr") ?? String(lrDefault));
  const l2 = Number(parseArg(args, "--l2") ?? l2Default);
  const epochs = Number(parseArg(args, "--epochs") ?? epochsDefault);
  const batchSize = Number(parseArg(args, "--batchSize") ?? "4096");
  const clipGradNorm = Number(parseArg(args, "--clipGradNorm") ?? "5");
  const seed = Number(parseArg(args, "--seed") ?? String(SEED));
  const useV42SampleWeightsRaw = (parseArg(args, "--useV42SampleWeights") ?? "true").toLowerCase();

  if (!Number.isFinite(lr) || lr <= 0) throw new Error(`Invalid --lr: ${lr}`);
  if (!Number.isFinite(l2) || l2 < 0) throw new Error(`Invalid --l2: ${l2}`);
  if (!Number.isFinite(epochs) || epochs < 1) throw new Error(`Invalid --epochs: ${epochs}`);
  if (!Number.isFinite(batchSize) || batchSize < 1) throw new Error(`Invalid --batchSize: ${batchSize}`);
  if (!Number.isFinite(clipGradNorm) || clipGradNorm <= 0) {
    throw new Error(`Invalid --clipGradNorm: ${clipGradNorm}`);
  }
  if (!Number.isFinite(seed)) throw new Error(`Invalid --seed: ${seed}`);
  if (!["true", "false", "1", "0"].includes(useV42SampleWeightsRaw)) {
    throw new Error(`Invalid --useV42SampleWeights: ${useV42SampleWeightsRaw}`);
  }
  const useV42SampleWeights = useV42SampleWeightsRaw === "true" || useV42SampleWeightsRaw === "1";

  return {
    dataPath,
    featureVersion,
    optimizer,
    lr,
    l2,
    epochs: Math.floor(epochs),
    batchSize: Math.floor(batchSize),
    clipGradNorm,
    seed: Math.floor(seed),
    useV42SampleWeights,
  };
}

function getFeatureNames(featureVersion: FeatureVersion): readonly string[] {
  if (featureVersion === "v43") return FEATURE_NAMES_V43;
  if (featureVersion === "v42") return FEATURE_NAMES_V42;
  return featureVersion === "v41" ? FEATURE_NAMES_V41 : FEATURE_NAMES_V4;
}

function getArtifactMeta(featureVersion: FeatureVersion): {
  path: string;
  modelVersion: "v4-logreg" | "v41-logreg" | "v42-logreg" | "v43-logreg";
} {
  if (featureVersion === "v43") {
    return {
      path: path.join(process.cwd(), "lib", "model", "artifacts", "v43_logreg.json"),
      modelVersion: "v43-logreg",
    };
  }

  if (featureVersion === "v42") {
    return {
      path: path.join(process.cwd(), "lib", "model", "artifacts", "v42_logreg.json"),
      modelVersion: "v42-logreg",
    };
  }

  if (featureVersion === "v41") {
    return {
      path: path.join(process.cwd(), "lib", "model", "artifacts", "v41_logreg.json"),
      modelVersion: "v41-logreg",
    };
  }

  return {
    path: path.join(process.cwd(), "lib", "model", "artifacts", "v4_logreg.json"),
    modelVersion: "v4-logreg",
  };
}

function extractFeatures(
  row: Record<string, unknown>,
  featureNames: readonly string[]
): number[] {
  const featureSource = (row.features && typeof row.features === "object")
    ? (row.features as Record<string, unknown>)
    : row;

  return featureNames.map((name) => toNum(featureSource[name]));
}

async function loadSamples(
  filePath: string,
  featureNames: readonly string[]
): Promise<TrainingSample[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`training file not found: ${filePath}`);
  }

  const samples: TrainingSample[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lines = 0;
  for await (const line of rl) {
    lines += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const matchId = String(row.matchId ?? row.matchKey ?? "");
      if (!matchId) continue;

      const yRaw = toNum(row.y);
      const y = yRaw >= 0.5 ? 1 : 0;
      const x = extractFeatures(row, featureNames);
      samples.push({ matchId, x, y });
    } catch {
      continue;
    }
  }

  console.log(`Loaded ${samples.length} samples from ${lines} lines`);
  return samples;
}

function splitByMatch(samples: TrainingSample[], seed: number): {
  train: TrainingSample[];
  val: TrainingSample[];
  splitMode: "group" | "row-fallback";
} {
  const uniqueMatchIds = Array.from(new Set(samples.map((s) => s.matchId)));
  shuffleInPlace(uniqueMatchIds, seed);

  const trainCount = Math.max(1, Math.floor(uniqueMatchIds.length * TRAIN_FRAC));
  const trainSet = new Set(uniqueMatchIds.slice(0, trainCount));

  let train: TrainingSample[] = [];
  let val: TrainingSample[] = [];

  for (const sample of samples) {
    if (trainSet.has(sample.matchId)) train.push(sample);
    else val.push(sample);
  }

  if (val.length === 0) {
    const shuffled = [...samples];
    shuffleInPlace(shuffled, seed + 1);
    const fallbackTrainCount = Math.max(1, Math.floor(shuffled.length * TRAIN_FRAC));
    train = shuffled.slice(0, fallbackTrainCount);
    val = shuffled.slice(fallbackTrainCount);

    if (val.length === 0 && train.length > 1) {
      val = train.slice(-1);
      train = train.slice(0, -1);
    }

    return { train, val, splitMode: "row-fallback" };
  }

  return { train, val, splitMode: "group" };
}

function computeStandardization(
  train: TrainingSample[],
  featureNames: readonly string[],
  skipPrefixes: readonly string[]
): { mean: number[]; std: number[] } {
  const dim = featureNames.length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  const skipIdx = new Set<number>();

  for (let i = 0; i < featureNames.length; i++) {
    if (skipPrefixes.some((prefix) => featureNames[i].startsWith(prefix))) {
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

function applyStandardization(samples: TrainingSample[], mean: number[], std: number[]): void {
  for (const sample of samples) {
    for (let i = 0; i < sample.x.length; i++) {
      sample.x[i] = (sample.x[i] - mean[i]) / std[i];
    }
  }
}

function predictOne(intercept: number, coeff: number[], x: number[]): number {
  let z = intercept;
  for (let j = 0; j < coeff.length; j++) {
    z += coeff[j] * x[j];
  }
  return sigmoid(z);
}

function evaluate(samples: TrainingSample[], intercept: number, coeff: number[], l2: number): Metrics & { probs: number[] } {
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
  const reg = coeff.reduce((sum, wj) => sum + 0.5 * l2 * wj * wj, 0);

  return {
    loss: logloss / n + reg,
    brier: brier / n,
    logloss: logloss / n,
    accuracy: correct / n,
    probs,
  };
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

function predictionQuantiles(probs: number[]): Quantiles {
  const sorted = [...probs].sort((a, b) => a - b);
  return {
    min: sorted.length ? sorted[0] : 0,
    p01: quantile(sorted, 0.01),
    p05: quantile(sorted, 0.05),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

function makeIndexArray(n: number): number[] {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return idx;
}

function buildSampleWeightFn(
  featureVersion: FeatureVersion,
  featureNames: readonly string[],
  enabled: boolean
): ((x: number[]) => number) | null {
  if ((featureVersion !== "v42" && featureVersion !== "v43") || !enabled) return null;

  const idx = new Map<string, number>();
  for (let i = 0; i < featureNames.length; i++) idx.set(featureNames[i], i);

  const get = (x: number[], name: string) => {
    const i = idx.get(name);
    return i === undefined ? 0 : x[i];
  };

  return (x: number[]) => {
    let w = 1;

    // Slightly emphasize chase states where signal should be stronger.
    if (get(x, "isChase") > 0.5) w *= 1.15;

    // Emphasize end-game and opening phases.
    if (get(x, "br_0_6") > 0.5 || get(x, "br_7_12") > 0.5) w *= 1.35;
    if (get(x, "br_91_120") > 0.5) w *= 1.20;

    // Emphasize high-pressure and extreme rrDelta buckets.
    if (get(x, "p_2_0_2_5") > 0.5 || get(x, "p_2_5_3_0") > 0.5 || get(x, "p_3p") > 0.5) {
      w *= 1.25;
    }
    if (get(x, "rrd_-3p") > 0.5 || get(x, "rrd_3p") > 0.5) {
      w *= 1.20;
    }

    return Math.max(0.25, Math.min(4, w));
  };
}

function printCalibrationByBattingSide(
  samples: TrainingSample[],
  intercept: number,
  coeff: number[]
): void {
  const idx = samples.length > 0 ? samples[0].x.length - 1 : -1;
  if (idx < 0) return;

  const summary = {
    A: { n: 0, predSum: 0, ySum: 0 },
    B: { n: 0, predSum: 0, ySum: 0 },
  };

  for (const sample of samples) {
    const p = predictOne(intercept, coeff, sample.x);
    const side = sample.x[idx] >= 0 ? "A" : "B";
    summary[side].n += 1;
    summary[side].predSum += p;
    summary[side].ySum += sample.y;
  }

  console.log("\nCalibration by battingTeamIsA:");
  for (const side of ["A", "B"] as const) {
    const s = summary[side];
    if (s.n === 0) continue;
    console.log(
      `  battingTeam=${side} n=${s.n} avgPred=${(s.predSum / s.n).toFixed(4)} meanY=${(s.ySum / s.n).toFixed(4)}`
    );
  }
}

function trainLogReg(
  train: TrainingSample[],
  val: TrainingSample[],
  options: TrainOptions,
  dim: number,
  sampleWeightFn: ((x: number[]) => number) | null
): { intercept: number; coeff: number[]; finalVal: Metrics; finalDist: Quantiles } {
  let intercept = 0;
  const coeff = new Array(dim).fill(0);

  let step = 0;
  let mB = 0;
  let vB = 0;
  const mW = new Array(dim).fill(0);
  const vW = new Array(dim).fill(0);

  for (let epoch = 1; epoch <= options.epochs; epoch++) {
    const indices = makeIndexArray(train.length);
    shuffleInPlace(indices, options.seed + epoch * 31);

    for (let start = 0; start < indices.length; start += options.batchSize) {
      const end = Math.min(indices.length, start + options.batchSize);
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
        gW[j] = gW[j] / batchN + options.l2 * coeff[j];
      }

      let normSq = gB * gB;
      for (let j = 0; j < dim; j++) normSq += gW[j] * gW[j];
      const norm = Math.sqrt(normSq);
      if (norm > options.clipGradNorm) {
        const scale = options.clipGradNorm / Math.max(1e-12, norm);
        gB *= scale;
        for (let j = 0; j < dim; j++) gW[j] *= scale;
      }

      if (options.optimizer === "adam") {
        step += 1;

        mB = ADAM_BETA1 * mB + (1 - ADAM_BETA1) * gB;
        vB = ADAM_BETA2 * vB + (1 - ADAM_BETA2) * gB * gB;
        const mBHat = mB / (1 - Math.pow(ADAM_BETA1, step));
        const vBHat = vB / (1 - Math.pow(ADAM_BETA2, step));
        intercept -= options.lr * mBHat / (Math.sqrt(vBHat) + ADAM_EPS);

        for (let j = 0; j < dim; j++) {
          mW[j] = ADAM_BETA1 * mW[j] + (1 - ADAM_BETA1) * gW[j];
          vW[j] = ADAM_BETA2 * vW[j] + (1 - ADAM_BETA2) * gW[j] * gW[j];
          const mHat = mW[j] / (1 - Math.pow(ADAM_BETA1, step));
          const vHat = vW[j] / (1 - Math.pow(ADAM_BETA2, step));
          coeff[j] -= options.lr * mHat / (Math.sqrt(vHat) + ADAM_EPS);
        }
      } else {
        intercept -= options.lr * gB;
        for (let j = 0; j < dim; j++) {
          coeff[j] -= options.lr * gW[j];
        }
      }
    }

    const trainEval = evaluate(train, intercept, coeff, options.l2);
    const validEval = evaluate(val, intercept, coeff, options.l2);
    const dist = predictionQuantiles(validEval.probs);

    console.log(`\nEpoch ${epoch}/${options.epochs}`);
    console.log(
      `train loss=${trainEval.loss.toFixed(6)}  valid loss=${validEval.loss.toFixed(6)}  valid brier=${validEval.brier.toFixed(6)}  valid logloss=${validEval.logloss.toFixed(6)}`
    );
    console.log(
      `valid pred dist: min=${dist.min.toFixed(4)} p01=${dist.p01.toFixed(4)} p05=${dist.p05.toFixed(4)} p50=${dist.p50.toFixed(4)} p95=${dist.p95.toFixed(4)} p99=${dist.p99.toFixed(4)} max=${dist.max.toFixed(4)}`
    );

    if (dist.p95 - dist.p05 < 0.2) {
      console.warn(
        "warning: validation prediction range is narrow (p95-p05 < 0.2). Consider lowering --l2 or adding stronger interaction features."
      );
    }
  }

  const finalEval = evaluate(val, intercept, coeff, options.l2);
  const finalDist = predictionQuantiles(finalEval.probs);

  return {
    intercept,
    coeff,
    finalVal: {
      loss: finalEval.loss,
      brier: finalEval.brier,
      logloss: finalEval.logloss,
      accuracy: finalEval.accuracy,
    },
    finalDist,
  };
}

async function main() {
  const options = parseOptions();
  const featureNames = getFeatureNames(options.featureVersion);
  const artifactMeta = getArtifactMeta(options.featureVersion);
  const skipStandardizationPrefixes =
    options.featureVersion === "v42" || options.featureVersion === "v43" ? ["br_", "wih_", "p_", "rrd_"] : [];
  const sampleWeightFn = buildSampleWeightFn(
    options.featureVersion,
    featureNames,
    options.useV42SampleWeights
  );

  console.log("=== Train LogReg (v4/v4.1/v4.2/v4.3) ===");
  console.log(`featureVersion: ${options.featureVersion}`);
  console.log(`modelVersion: ${artifactMeta.modelVersion}`);
  console.log(`optimizer: ${options.optimizer}`);
  console.log(`data: ${options.dataPath}`);
  console.log(`lr=${options.lr} l2=${options.l2} epochs=${options.epochs} batchSize=${options.batchSize} clipGradNorm=${options.clipGradNorm}`);
  if (skipStandardizationPrefixes.length > 0) {
    console.log(`skipStandardizationPrefixes: ${skipStandardizationPrefixes.join(",")}`);
  }
  if (options.featureVersion === "v42" || options.featureVersion === "v43") {
    console.log(`useV42SampleWeights: ${options.useV42SampleWeights}`);
  }

  const samples = await loadSamples(options.dataPath, featureNames);
  if (samples.length < 100) {
    throw new Error(`not enough samples: ${samples.length}`);
  }

  const { train, val, splitMode } = splitByMatch(samples, options.seed);
  console.log(`Train rows: ${train.length}, Val rows: ${val.length}, split: ${splitMode}`);

  const { mean, std } = computeStandardization(train, featureNames, skipStandardizationPrefixes);
  applyStandardization(train, mean, std);
  applyStandardization(val, mean, std);

  const dim = featureNames.length;
  const trained = trainLogReg(train, val, options, dim, sampleWeightFn);

  console.log("\nFinal validation metrics:");
  console.log(`Brier:   ${trained.finalVal.brier.toFixed(6)}`);
  console.log(`LogLoss: ${trained.finalVal.logloss.toFixed(6)}`);
  console.log(`Acc@0.5: ${(trained.finalVal.accuracy * 100).toFixed(2)}%`);
  console.log(
    `Pred spread: p05=${trained.finalDist.p05.toFixed(4)} p95=${trained.finalDist.p95.toFixed(4)} (width=${(trained.finalDist.p95 - trained.finalDist.p05).toFixed(4)})`
  );
  if (options.featureVersion === "v43") {
    printCalibrationByBattingSide(val, trained.intercept, trained.coeff);
  }

  const artifact: LogRegArtifact = {
    modelVersion: artifactMeta.modelVersion,
    featureVersion: options.featureVersion,
    trainedAt: new Date().toISOString(),
    featureNames: [...featureNames],
    standardize: true,
    mean,
    std,
    intercept: trained.intercept,
    coeff: trained.coeff,
    metrics: {
      brier: trained.finalVal.brier,
      logloss: trained.finalVal.logloss,
      accuracy: trained.finalVal.accuracy,
    },
    notes: `${splitMode} split by matchId, optimizer=${options.optimizer}, v42SampleWeights=${options.useV42SampleWeights}`,
    skipStandardizationPrefixes,
  };

  fs.mkdirSync(path.dirname(artifactMeta.path), { recursive: true });
  fs.writeFileSync(artifactMeta.path, JSON.stringify(artifact, null, 2), "utf-8");
  console.log(`\nSaved artifact: ${artifactMeta.path}`);
}

main().catch((err) => {
  console.error("train:v4logreg failed:", err);
  process.exit(1);
});
