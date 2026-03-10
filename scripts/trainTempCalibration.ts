import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

type Row = {
  matchKey?: string;
  matchId?: string;
  y?: number;
  features?: Record<string, number>;
};

type Sample = {
  matchId: string;
  featureRow: Record<string, number>;
  y: number;
};

type LogRegArtifact = {
  modelVersion: "v42-logreg";
  featureNames: string[];
  standardize: boolean;
  mean: number[];
  std: number[];
  intercept: number;
  coeff: number[];
};

type TempArtifact = {
  modelVersion: "v42-logreg";
  calibrationVersion: "temp-v1";
  trainedAt: string;
  method: "temperature";
  temperature: number;
  metricsBefore: {
    brier: number;
    logloss: number;
  };
  metricsAfter: {
    brier: number;
    logloss: number;
  };
  notes: string;
};

type BinRow = {
  bin: string;
  count: number;
  meanPred: number;
  meanActual: number;
};

const TRAIN_FRAC = 0.8;

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function logit(p: number): number {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
}

function applyTemperature(pRaw: number, t: number): number {
  return sigmoid(logit(pRaw) / t);
}

async function loadRows(filePath: string): Promise<Sample[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`data file not found: ${filePath}`);
  }

  const out: Sample[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lines = 0;
  for await (const line of rl) {
    lines += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const row = JSON.parse(trimmed) as Row;
      const matchId = String(row.matchId ?? row.matchKey ?? "");
      if (!matchId) continue;
      const featureRow =
        row.features && typeof row.features === "object"
          ? (row.features as Record<string, number>)
          : {};
      const y = toNum(row.y) >= 0.5 ? 1 : 0;
      out.push({ matchId, featureRow, y });
    } catch {
      continue;
    }
  }

  console.log(`Loaded ${out.length} rows from ${lines} lines`);
  return out;
}

function splitByMatch(samples: Sample[], seed: number): { train: Sample[]; val: Sample[] } {
  const ids = Array.from(new Set(samples.map((s) => s.matchId)));
  shuffleInPlace(ids, seed);
  const trainCount = Math.max(1, Math.floor(ids.length * TRAIN_FRAC));
  const trainSet = new Set(ids.slice(0, trainCount));
  return {
    train: samples.filter((s) => trainSet.has(s.matchId)),
    val: samples.filter((s) => !trainSet.has(s.matchId)),
  };
}

function loadModel(modelPath: string): LogRegArtifact {
  if (!fs.existsSync(modelPath)) {
    throw new Error(`model artifact not found: ${modelPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(modelPath, "utf-8")) as LogRegArtifact;
  if (parsed.modelVersion !== "v42-logreg") {
    throw new Error(`Expected v42-logreg artifact, got ${parsed.modelVersion}`);
  }
  return parsed;
}

function predictRawProb(model: LogRegArtifact, featureRow: Record<string, number>): number {
  const x = model.featureNames.map((name) => toNum(featureRow[name]));
  if (model.standardize) {
    for (let i = 0; i < x.length; i++) {
      const mean = toNum(model.mean?.[i]);
      const stdRaw = toNum(model.std?.[i]);
      const std = stdRaw > 1e-12 ? stdRaw : 1e-12;
      x[i] = (x[i] - mean) / std;
    }
  }

  let z = toNum(model.intercept);
  for (let i = 0; i < x.length; i++) {
    z += toNum(model.coeff[i]) * x[i];
  }
  return sigmoid(z);
}

function evalMetrics(points: Array<{ p: number; y: number }>): { brier: number; logloss: number; bins: BinRow[] } {
  let brier = 0;
  let logloss = 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, pred: 0, truth: 0 }));

  for (const point of points) {
    const diff = point.p - point.y;
    brier += diff * diff;
    const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, point.p));
    logloss += -(point.y * Math.log(pSafe) + (1 - point.y) * Math.log(1 - pSafe));

    const bin = Math.min(9, Math.floor(point.p * 10));
    bins[bin].count += 1;
    bins[bin].pred += point.p;
    bins[bin].truth += point.y;
  }

  const n = Math.max(1, points.length);
  return {
    brier: brier / n,
    logloss: logloss / n,
    bins: bins.map((b, i) => ({
      bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
      count: b.count,
      meanPred: b.count > 0 ? b.pred / b.count : 0,
      meanActual: b.count > 0 ? b.truth / b.count : 0,
    })),
  };
}

function printBins(title: string, bins: BinRow[]): void {
  console.log(`\n=== ${title} Calibration (10 bins) ===`);
  for (const row of bins) {
    if (row.count > 0) {
      console.log(
        `${row.bin}  n=${row.count.toString().padStart(6)}  pred=${row.meanPred.toFixed(4)}  actual=${row.meanActual.toFixed(4)}`
      );
    }
  }

  const low = bins.find((b) => b.bin === "0.0-0.1");
  const high = bins.find((b) => b.bin === "0.9-1.0");
  console.log(`\n${title} tail bins:`);
  if (low) {
    console.log(`  0.0-0.1 -> n=${low.count} pred=${low.meanPred.toFixed(4)} actual=${low.meanActual.toFixed(4)}`);
  }
  if (high) {
    console.log(`  0.9-1.0 -> n=${high.count} pred=${high.meanPred.toFixed(4)} actual=${high.meanActual.toFixed(4)}`);
  }
}

function fitTemperature(rawPoints: Array<{ p: number; y: number }>): number {
  let bestT = 1;
  let bestLoss = Number.POSITIVE_INFINITY;

  const score = (t: number) => {
    let loss = 0;
    for (const point of rawPoints) {
      const p = applyTemperature(point.p, t);
      const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, p));
      loss += -(point.y * Math.log(pSafe) + (1 - point.y) * Math.log(1 - pSafe));
    }
    return loss / Math.max(1, rawPoints.length);
  };

  for (let t = 0.5; t <= 5.0001; t += 0.05) {
    const tt = Number(t.toFixed(3));
    const loss = score(tt);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestT = tt;
    }
  }

  const left = Math.max(0.5, bestT - 0.1);
  const right = Math.min(5, bestT + 0.1);
  for (let t = left; t <= right + 1e-9; t += 0.005) {
    const tt = Number(t.toFixed(4));
    const loss = score(tt);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestT = tt;
    }
  }

  return bestT;
}

async function main() {
  const args = process.argv.slice(2);
  const dataPath = path.resolve(
    process.cwd(),
    parseArg(args, "--data") ?? "training/training_rows_v42_stratified.jsonl"
  );
  const modelPath = path.resolve(
    process.cwd(),
    parseArg(args, "--model") ?? "lib/model/artifacts/v42_logreg.json"
  );
  const outPath = path.resolve(
    process.cwd(),
    parseArg(args, "--out") ?? "lib/model/artifacts/v42_temp_calibration.json"
  );
  const seed = Number(parseArg(args, "--seed") ?? "42");

  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid --seed: ${seed}`);
  }

  console.log("=== Train Temperature Calibration (v42-logreg) ===");
  console.log(`data: ${dataPath}`);
  console.log(`model: ${modelPath}`);
  console.log(`out: ${outPath}`);

  const model = loadModel(modelPath);
  const samples = await loadRows(dataPath);
  if (samples.length < 100) {
    throw new Error(`not enough rows: ${samples.length}`);
  }

  const { val } = splitByMatch(samples, Math.floor(seed));
  console.log(`Validation rows used for temperature fit: ${val.length}`);

  const rawPoints = val.map((s) => ({ p: predictRawProb(model, s.featureRow), y: s.y }));
  const bestT = fitTemperature(rawPoints);

  const before = evalMetrics(rawPoints);
  const afterPoints = rawPoints.map((pt) => ({ p: applyTemperature(pt.p, bestT), y: pt.y }));
  const after = evalMetrics(afterPoints);

  console.log(`\nBest temperature: ${bestT.toFixed(4)}`);
  console.log(`Before: brier=${before.brier.toFixed(6)} logloss=${before.logloss.toFixed(6)}`);
  console.log(`After:  brier=${after.brier.toFixed(6)} logloss=${after.logloss.toFixed(6)}`);

  printBins("v42 Raw", before.bins);
  printBins("v42 Temp-Calibrated", after.bins);

  const artifact: TempArtifact = {
    modelVersion: "v42-logreg",
    calibrationVersion: "temp-v1",
    trainedAt: new Date().toISOString(),
    method: "temperature",
    temperature: bestT,
    metricsBefore: {
      brier: before.brier,
      logloss: before.logloss,
    },
    metricsAfter: {
      brier: after.brier,
      logloss: after.logloss,
    },
    notes: "Fit on validation split by matchKey; preserves monotonicity",
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2), "utf-8");
  console.log(`\nSaved artifact: ${outPath}`);
}

main().catch((err) => {
  console.error("trainTempCalibration failed:", err);
  process.exit(1);
});
