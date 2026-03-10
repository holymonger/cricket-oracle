import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { computeWinProbV3 } from "@/lib/model/v3Lgbm";
import { predictFromFeaturesV4 } from "@/lib/model/v4LogReg";
import { predictFromFeaturesV41 } from "@/lib/model/v41LogReg";
import { predictFromFeaturesV42 } from "@/lib/model/v42LogReg";
import { predictFromFeaturesV43 } from "@/lib/model/v43LogReg";
import type { MatchState } from "@/lib/model/types";

type FeatureVersion = "v4" | "v41" | "v42" | "v43";
type BallsRemainingBand =
  | "band0"
  | "band1"
  | "band2"
  | "band3"
  | "band4"
  | "band5"
  | "band6"
  | "band7";

type Row = {
  matchKey?: string;
  matchId?: string;
  competition?: string;
  innings?: number;
  battingTeam?: string;
  legalBallNumber?: number;
  y?: number;
  features?: Record<string, number>;
};

type TrainingSample = {
  matchId: string;
  featureRow: Record<string, number>;
  y: number;
  innings: number;
  battingTeam: string;
};

type PredPoint = {
  pred: number;
  actual: number;
  ballsRemaining: number;
};

type CalibrationBin = {
  bin: string;
  count: number;
  meanPred: number;
  meanActual: number;
};

type DistStats = {
  min: number;
  p01: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

type BandBreakdownRow = {
  band: BallsRemainingBand;
  label: string;
  count: number;
  brier: number;
  logloss: number;
  accuracy: number;
  avgPred: number;
  meanY: number;
};

const BALLS_REMAINING_BANDS = [
  { key: "band0", label: "0-6", min: 0, max: 6 },
  { key: "band1", label: "7-12", min: 7, max: 12 },
  { key: "band2", label: "13-18", min: 13, max: 18 },
  { key: "band3", label: "19-24", min: 19, max: 24 },
  { key: "band4", label: "25-36", min: 25, max: 36 },
  { key: "band5", label: "37-60", min: 37, max: 60 },
  { key: "band6", label: "61-90", min: 61, max: 90 },
  { key: "band7", label: "91-120", min: 91, max: 120 },
] as const;

const SEED = 42;
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

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const qq = Math.max(0, Math.min(1, q));
  const idx = qq * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function predictionDist(points: PredPoint[]): DistStats {
  const sorted = points.map((p) => p.pred).sort((a, b) => a - b);
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

function getBallsRemainingBand(ballsRemainingRaw: number): BallsRemainingBand {
  const ballsRemaining = Math.max(0, Math.min(120, Math.round(toNum(ballsRemainingRaw))));
  for (const band of BALLS_REMAINING_BANDS) {
    if (ballsRemaining >= band.min && ballsRemaining <= band.max) {
      return band.key;
    }
  }
  return "band0";
}

async function loadRows(filePath: string): Promise<TrainingSample[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
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
      const row = JSON.parse(trimmed) as Row;
      const matchId = String(row.matchId ?? row.matchKey ?? "");
      if (!matchId) continue;

      const featureRow =
        row.features && typeof row.features === "object"
          ? (row.features as Record<string, number>)
          : {};

      const y = toNum(row.y);
      const yBinary = y >= 0.5 ? 1 : 0;
      const innings = Number(row.innings ?? 1);
      const battingTeam = String(row.battingTeam ?? "A");

      samples.push({
        matchId,
        featureRow,
        y: yBinary,
        innings,
        battingTeam,
      });
    } catch {
      continue;
    }
  }

  console.log(`Loaded ${samples.length} samples from ${lines} lines`);
  return samples;
}

function splitByMatch(samples: TrainingSample[]): { train: TrainingSample[]; val: TrainingSample[] } {
  const uniqueMatchIds = Array.from(new Set(samples.map((s) => s.matchId)));
  shuffleInPlace(uniqueMatchIds, SEED);

  const trainCount = Math.max(1, Math.floor(uniqueMatchIds.length * TRAIN_FRAC));
  const trainSet = new Set(uniqueMatchIds.slice(0, trainCount));

  const train = samples.filter((s) => trainSet.has(s.matchId));
  const val = samples.filter((s) => !trainSet.has(s.matchId));

  return { train, val };
}

function reconstructMatchState(
  features: Record<string, number>,
  innings: number,
  battingTeam: string
): MatchState {
  const runs = Math.round(toNum(features.runs));
  const wickets = Math.round(toNum(features.wickets));
  const balls = Math.round(toNum(features.balls));
  const targetRuns = innings === 2 ? Math.round(toNum(features.targetRuns ?? 0)) : null;

  return {
    innings: innings as 1 | 2,
    battingTeam: battingTeam as "A" | "B",
    runs,
    wickets: Math.min(10, Math.max(0, wickets)),
    balls: Math.min(120, Math.max(0, balls)),
    targetRuns: targetRuns && targetRuns > 0 ? targetRuns : undefined,
  };
}

function evaluateMetrics(points: PredPoint[]) {
  let brier = 0;
  let logloss = 0;
  let correct = 0;

  const bins = Array.from({ length: 10 }, () => ({ count: 0, pred: 0, truth: 0 }));

  for (const point of points) {
    const { pred, actual } = point;
    const diff = pred - actual;
    brier += diff * diff;

    const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, pred));
    logloss += -(actual * Math.log(pSafe) + (1 - actual) * Math.log(1 - pSafe));

    if ((pred >= 0.5 ? 1 : 0) === actual) correct += 1;

    const bin = Math.min(9, Math.floor(pred * 10));
    bins[bin].count += 1;
    bins[bin].pred += pred;
    bins[bin].truth += actual;
  }

  const n = Math.max(1, points.length);
  return {
    brier: brier / n,
    logloss: logloss / n,
    accuracy: correct / n,
    dist: predictionDist(points),
    calibrationBins: bins.map((b, i) => ({
      bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
      count: b.count,
      meanPred: b.count > 0 ? b.pred / b.count : 0,
      meanActual: b.count > 0 ? b.truth / b.count : 0,
    })),
  };
}

function findBin(bins: CalibrationBin[], label: string): CalibrationBin | undefined {
  return bins.find((b) => b.bin === label);
}

function evaluateByBallsRemainingBand(points: PredPoint[]): BandBreakdownRow[] {
  const grouped = new Map<BallsRemainingBand, PredPoint[]>();
  for (const band of BALLS_REMAINING_BANDS) {
    grouped.set(band.key, []);
  }

  for (const point of points) {
    const band = getBallsRemainingBand(point.ballsRemaining);
    (grouped.get(band) ?? []).push(point);
  }

  const rows: BandBreakdownRow[] = [];
  for (const band of BALLS_REMAINING_BANDS) {
    const list = grouped.get(band.key) ?? [];
    const n = list.length;
    if (n === 0) {
      rows.push({
        band: band.key,
        label: band.label,
        count: 0,
        brier: 0,
        logloss: 0,
        accuracy: 0,
        avgPred: 0,
        meanY: 0,
      });
      continue;
    }

    let brier = 0;
    let logloss = 0;
    let correct = 0;
    let sumPred = 0;
    let sumY = 0;

    for (const point of list) {
      const diff = point.pred - point.actual;
      brier += diff * diff;
      const pSafe = Math.min(1 - 1e-15, Math.max(1e-15, point.pred));
      logloss += -(point.actual * Math.log(pSafe) + (1 - point.actual) * Math.log(1 - pSafe));
      if ((point.pred >= 0.5 ? 1 : 0) === point.actual) correct += 1;
      sumPred += point.pred;
      sumY += point.actual;
    }

    rows.push({
      band: band.key,
      label: band.label,
      count: n,
      brier: brier / n,
      logloss: logloss / n,
      accuracy: correct / n,
      avgPred: sumPred / n,
      meanY: sumY / n,
    });
  }

  return rows;
}

function printPredictionDist(label: string, dist: DistStats): void {
  console.log(`\n=== ${label} Prediction Distribution ===`);
  console.log(
    `min=${dist.min.toFixed(4)} p01=${dist.p01.toFixed(4)} p05=${dist.p05.toFixed(4)} p50=${dist.p50.toFixed(4)} p95=${dist.p95.toFixed(4)} p99=${dist.p99.toFixed(4)} max=${dist.max.toFixed(4)}`
  );
}

function printBandBreakdown(label: string, rows: BandBreakdownRow[]): void {
  console.log(`\n=== ${label} Breakdown by BallsRemaining Band ===`);
  for (const row of rows) {
    if (row.count === 0) continue;
    console.log(
      `${row.band} (${row.label})  n=${row.count
        .toString()
        .padStart(6)}  brier=${row.brier.toFixed(6)}  logloss=${row.logloss.toFixed(6)}  acc=${(
        row.accuracy * 100
      ).toFixed(2)}%  avgPred=${row.avgPred.toFixed(4)}  meanY=${row.meanY.toFixed(4)}`
    );
  }
}

async function main() {
  console.log("=== Compare V3 vs V4 LogReg variant on same validation set ===\n");

  const args = process.argv.slice(2);
  const dataIdx = args.findIndex((arg) => arg === "--data");
  const featureVersionIdx = args.findIndex((arg) => arg === "--featureVersion");
  const featureVersionRaw = featureVersionIdx >= 0 ? args[featureVersionIdx + 1] : "v4";
  const featureVersion: FeatureVersion =
    featureVersionRaw === "v43"
      ? "v43"
      : featureVersionRaw === "v42"
      ? "v42"
      : featureVersionRaw === "v41"
      ? "v41"
      : "v4";

  const defaultDataPath =
    featureVersion === "v43"
      ? "training/training_rows_v43_stratified.jsonl"
      : featureVersion === "v42"
      ? "training/training_rows_v42_stratified.jsonl"
      : featureVersion === "v41"
      ? "training/training_rows_v41.jsonl"
      : "training/training_rows_v4.jsonl";
  const dataPath = dataIdx >= 0 ? args[dataIdx + 1] : defaultDataPath;

  const resolvedPath = path.resolve(process.cwd(), dataPath);
  console.log(`Feature version: ${featureVersion}`);
  console.log(`Data file: ${resolvedPath}\n`);

  const samples = await loadRows(resolvedPath);
  if (samples.length < 100) {
    throw new Error(`not enough samples: ${samples.length}`);
  }

  const { train: _trainSamples, val: valSamples } = splitByMatch(samples);
  console.log(
    `Using validation set: ${valSamples.length} rows from ${new Set(valSamples.map((s) => s.matchId)).size} unique matches\n`
  );

  const v3Predictions: PredPoint[] = [];
  const vxPredictions: PredPoint[] = [];
  const v42RawPredictions: PredPoint[] = [];

  let successCount = 0;
  let errorCount = 0;

  for (const sample of valSamples) {
    try {
      let vxResult;
      try {
        vxResult =
          featureVersion === "v43"
            ? predictFromFeaturesV43(sample.featureRow)
            : featureVersion === "v42"
            ? predictFromFeaturesV42(sample.featureRow)
            : featureVersion === "v41"
            ? predictFromFeaturesV41(sample.featureRow)
            : predictFromFeaturesV4(sample.featureRow);
      } catch {
        vxResult = {
          winProb: 0.5,
          modelVersion:
            featureVersion === "v43"
              ? "v43-logreg"
              : featureVersion === "v42"
              ? "v42-logreg"
              : featureVersion === "v41"
              ? "v41-logreg"
              : "v4-logreg",
          features: {},
        };
      }

      const state = reconstructMatchState(sample.featureRow, sample.innings, sample.battingTeam);
      const v3Result = computeWinProbV3(state, sample.featureRow);

      const ballsRemaining = toNum(sample.featureRow.ballsRemaining);
      v3Predictions.push({ pred: v3Result.winProb, actual: sample.y, ballsRemaining });
      vxPredictions.push({ pred: vxResult.winProb, actual: sample.y, ballsRemaining });
      if (featureVersion === "v42") {
        const raw = toNum(vxResult.features?.__rawProb);
        const rawProb = raw > 0 && raw < 1 ? raw : vxResult.winProb;
        v42RawPredictions.push({ pred: rawProb, actual: sample.y, ballsRemaining });
      }

      successCount += 1;
    } catch {
      errorCount += 1;
    }
  }

  console.log(`Evaluated ${successCount} rows (${errorCount} errors)\n`);

  const v3Metrics = evaluateMetrics(v3Predictions);
  const vxMetrics = evaluateMetrics(vxPredictions);
  const v42RawMetrics = featureVersion === "v42" ? evaluateMetrics(v42RawPredictions) : null;

  const vxLabel =
    featureVersion === "v43"
      ? "V4.3"
      : featureVersion === "v42"
      ? "V4.2"
      : featureVersion === "v41"
      ? "V4.1"
      : "V4";

  console.log("=== V3 Metrics (Heuristic) ===");
  console.log(`Brier:    ${v3Metrics.brier.toFixed(6)}`);
  console.log(`LogLoss:  ${v3Metrics.logloss.toFixed(6)}`);
  console.log(`Acc@0.5:  ${(v3Metrics.accuracy * 100).toFixed(2)}%`);

  console.log(`\n=== ${vxLabel} Metrics (LogReg) ===`);
  console.log(`Brier:    ${vxMetrics.brier.toFixed(6)}`);
  console.log(`LogLoss:  ${vxMetrics.logloss.toFixed(6)}`);
  console.log(`Acc@0.5:  ${(vxMetrics.accuracy * 100).toFixed(2)}%`);

  if (featureVersion === "v42" && v42RawMetrics) {
    console.log(`\n=== ${vxLabel} Raw vs Calibrated ===`);
    console.log(
      `Raw        Brier=${v42RawMetrics.brier.toFixed(6)} LogLoss=${v42RawMetrics.logloss.toFixed(6)} Acc@0.5=${(
        v42RawMetrics.accuracy * 100
      ).toFixed(2)}%`
    );
    console.log(
      `Calibrated Brier=${vxMetrics.brier.toFixed(6)} LogLoss=${vxMetrics.logloss.toFixed(6)} Acc@0.5=${(
        vxMetrics.accuracy * 100
      ).toFixed(2)}%`
    );
  }

  console.log("\n=== Comparison ===");
  const brierDiff = vxMetrics.brier - v3Metrics.brier;
  const loglossGainPct = ((v3Metrics.logloss - vxMetrics.logloss) / v3Metrics.logloss) * 100;
  const accDiff = (vxMetrics.accuracy - v3Metrics.accuracy) * 100;

  console.log(
    `Brier delta:       ${brierDiff > 0 ? "+" : ""}${brierDiff.toFixed(6)} (${vxLabel.toLowerCase()} ${
      brierDiff < 0 ? "better" : "worse"
    })`
  );
  console.log(
    `LogLoss gain:      ${loglossGainPct.toFixed(2)}% (${vxLabel.toLowerCase()} ${
      loglossGainPct > 0 ? "better" : "worse"
    })`
  );
  console.log(
    `Acc@0.5 delta:     ${accDiff > 0 ? "+" : ""}${accDiff.toFixed(2)}% (${vxLabel.toLowerCase()} ${
      accDiff > 0 ? "better" : "worse"
    })`
  );

  console.log("\n=== V3 Calibration (10 bins) ===");
  for (const row of v3Metrics.calibrationBins) {
    if (row.count > 0) {
      console.log(
        `${row.bin}  n=${row.count.toString().padStart(6)}  pred=${row.meanPred.toFixed(4)}  actual=${row.meanActual.toFixed(4)}`
      );
    }
  }

  console.log(`\n=== ${vxLabel} Calibration (10 bins) ===`);
  for (const row of vxMetrics.calibrationBins) {
    if (row.count > 0) {
      console.log(
        `${row.bin}  n=${row.count.toString().padStart(6)}  pred=${row.meanPred.toFixed(4)}  actual=${row.meanActual.toFixed(4)}`
      );
    }
  }

  if (featureVersion === "v42" && v42RawMetrics) {
    console.log(`\n=== ${vxLabel} Raw Calibration (10 bins) ===`);
    for (const row of v42RawMetrics.calibrationBins) {
      if (row.count > 0) {
        console.log(
          `${row.bin}  n=${row.count.toString().padStart(6)}  pred=${row.meanPred.toFixed(4)}  actual=${row.meanActual.toFixed(4)}`
        );
      }
    }

    const rawLow = findBin(v42RawMetrics.calibrationBins as CalibrationBin[], "0.0-0.1");
    const rawHigh = findBin(v42RawMetrics.calibrationBins as CalibrationBin[], "0.9-1.0");
    const calLow = findBin(vxMetrics.calibrationBins as CalibrationBin[], "0.0-0.1");
    const calHigh = findBin(vxMetrics.calibrationBins as CalibrationBin[], "0.9-1.0");
    console.log(`\n=== ${vxLabel} Tail Bins (Raw -> Calibrated) ===`);
    if (rawLow) {
      console.log(
        `0.0-0.1 raw: n=${rawLow.count} pred=${rawLow.meanPred.toFixed(4)} actual=${rawLow.meanActual.toFixed(4)}`
      );
    }
    if (calLow) {
      console.log(
        `0.0-0.1 cal: n=${calLow.count} pred=${calLow.meanPred.toFixed(4)} actual=${calLow.meanActual.toFixed(4)}`
      );
    }
    if (rawHigh) {
      console.log(
        `0.9-1.0 raw: n=${rawHigh.count} pred=${rawHigh.meanPred.toFixed(4)} actual=${rawHigh.meanActual.toFixed(4)}`
      );
    }
    if (calHigh) {
      console.log(
        `0.9-1.0 cal: n=${calHigh.count} pred=${calHigh.meanPred.toFixed(4)} actual=${calHigh.meanActual.toFixed(4)}`
      );
    }
  }

  printPredictionDist("V3", v3Metrics.dist);
  if (featureVersion === "v42" && v42RawMetrics) {
    printPredictionDist(`${vxLabel} Raw`, v42RawMetrics.dist);
  }
  printPredictionDist(vxLabel, vxMetrics.dist);

  printBandBreakdown("V3", evaluateByBallsRemainingBand(v3Predictions));
  if (featureVersion === "v42") {
    printBandBreakdown(`${vxLabel} Raw`, evaluateByBallsRemainingBand(v42RawPredictions));
  }
  printBandBreakdown(vxLabel, evaluateByBallsRemainingBand(vxPredictions));

  const winner = vxMetrics.logloss < v3Metrics.logloss ? `${vxLabel} (LogReg)` : "V3 (Heuristic)";
  console.log(`\n>>> Winner by LogLoss: ${winner}`);
}

main().catch((err) => {
  console.error("eval:compare:v3v4 failed:", err);
  process.exit(1);
});
