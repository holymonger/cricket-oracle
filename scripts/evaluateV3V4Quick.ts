import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createHash } from "crypto";

type JsonRecord = Record<string, any>;

type Metrics = {
  count: number;
  logloss: number;
  brier: number;
  accuracy: number;
  auc: number;
};

const FEATURE_NAMES_V3 = [
  "runs",
  "wickets",
  "balls",
  "ballsRemaining",
  "rr",
  "targetRuns",
  "runsNeeded",
  "rrr",
  "runsLast6",
  "wktsLast6",
  "dotsLast6",
  "boundariesLast6",
  "runsLast12",
  "wktsLast12",
  "dotsLast12",
  "boundariesLast12",
  "runsThisBallTotal",
  "isWicketThisBall",
  "isBoundaryThisBall",
] as const;

const FEATURE_NAMES_V4_EXTRA = [
  "isChase",
  "isPowerplay",
  "isDeath",
  "wicketsInHand",
  "rrDelta",
  "rrLast12",
  "dotRateLast12",
  "boundaryRateLast12",
  "ballsRemainingFrac",
] as const;

const FEATURE_NAMES_V4 = [...FEATURE_NAMES_V3, ...FEATURE_NAMES_V4_EXTRA] as const;

const SCALE: Record<string, number> = {
  runs: 250,
  wickets: 10,
  balls: 120,
  ballsRemaining: 120,
  rr: 20,
  targetRuns: 250,
  runsNeeded: 250,
  rrr: 20,
  runsLast6: 36,
  wktsLast6: 6,
  dotsLast6: 6,
  boundariesLast6: 6,
  runsLast12: 72,
  wktsLast12: 12,
  dotsLast12: 12,
  boundariesLast12: 12,
  runsThisBallTotal: 7,
  isWicketThisBall: 1,
  isBoundaryThisBall: 1,
  isChase: 1,
  isPowerplay: 1,
  isDeath: 1,
  wicketsInHand: 10,
  rrDelta: 20,
  rrLast12: 20,
  dotRateLast12: 1,
  boundaryRateLast12: 1,
  ballsRemainingFrac: 1,
};

function toNumber(v: any): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

function deriveV4Extras(row: JsonRecord): Record<(typeof FEATURE_NAMES_V4_EXTRA)[number], number> {
  const innings = toNumber(row.innings);
  const balls = toNumber(row.balls);
  const wickets = toNumber(row.wickets);
  const rr = toNumber(row.rr);
  const rrr = toNumber(row.rrr);
  const runsLast12 = toNumber(row.runsLast12);
  const dotsLast12 = toNumber(row.dotsLast12);
  const boundariesLast12 = toNumber(row.boundariesLast12);
  const ballsRemaining = toNumber(row.ballsRemaining);

  return {
    isChase: innings === 2 ? 1 : 0,
    isPowerplay: balls <= 36 ? 1 : 0,
    isDeath: balls > 90 ? 1 : 0,
    wicketsInHand: Math.max(0, 10 - wickets),
    rrDelta: innings === 2 ? rrr - rr : 0,
    rrLast12: (runsLast12 / 12) * 6,
    dotRateLast12: dotsLast12 / 12,
    boundaryRateLast12: boundariesLast12 / 12,
    ballsRemainingFrac: ballsRemaining / 120,
  };
}

function featureVector(row: JsonRecord, names: readonly string[]): number[] {
  return names.map((name) => {
    const raw = toNumber(row[name]);
    const scale = SCALE[name] ?? 1;
    return safeDiv(raw, scale);
  });
}

function featureVectorV4(row: JsonRecord): number[] {
  const extras = deriveV4Extras(row);
  const merged = { ...row, ...extras };
  return featureVector(merged, FEATURE_NAMES_V4);
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function dot(w: number[], x: number[]): number {
  let s = w[0];
  for (let i = 0; i < x.length; i++) s += w[i + 1] * x[i];
  return s;
}

function predict(w: number[], x: number[]): number {
  return sigmoid(dot(w, x));
}

function stableLogloss(y: number, p: number): number {
  const eps = 1e-12;
  const q = Math.max(eps, Math.min(1 - eps, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

function hashToBucket(id: string, buckets = 10): number {
  const h = createHash("md5").update(id).digest("hex").slice(0, 8);
  const v = parseInt(h, 16);
  return v % buckets;
}

async function streamRows(filePath: string, onRow: (row: JsonRecord) => void | Promise<void>) {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      await onRow(row);
    } catch {
      continue;
    }
  }
}

async function trainModel(
  filePath: string,
  names: readonly string[],
  options: { epochs: number; lr: number; l2: number; sampleEvery: number }
): Promise<number[]> {
  const dim = names.length;
  const w = new Array(dim + 1).fill(0);

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    let seen = 0;
    let trainCount = 0;

    await streamRows(filePath, (row) => {
      seen += 1;
      if (options.sampleEvery > 1 && seen % options.sampleEvery !== 0) return;

      const matchId = String(row.matchId ?? "");
      const bucket = hashToBucket(matchId, 10);
      const isVal = bucket === 0 || bucket === 1;
      if (isVal) return;

      const y = toNumber(row.y) >= 0.5 ? 1 : 0;
      const x = names === FEATURE_NAMES_V4 ? featureVectorV4(row) : featureVector(row, names);

      const p = predict(w, x);
      const err = p - y;

      w[0] -= options.lr * (err + options.l2 * w[0]);
      for (let i = 0; i < x.length; i++) {
        w[i + 1] -= options.lr * (err * x[i] + options.l2 * w[i + 1]);
      }

      trainCount += 1;
    });

    console.log(`epoch ${epoch + 1}/${options.epochs} done (${trainCount} train rows)`);
  }

  return w;
}

function computeAUC(scores: Array<{ y: number; p: number }>): number {
  if (scores.length === 0) return 0.5;
  const sorted = [...scores].sort((a, b) => a.p - b.p);

  let rankSumPos = 0;
  let pos = 0;
  let neg = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].y === 1) {
      rankSumPos += i + 1;
      pos += 1;
    } else {
      neg += 1;
    }
  }

  if (pos === 0 || neg === 0) return 0.5;
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

async function evaluateModel(filePath: string, names: readonly string[], w: number[], sampleEvery: number): Promise<Metrics> {
  let count = 0;
  let ll = 0;
  let brier = 0;
  let correct = 0;
  let seen = 0;
  const scores: Array<{ y: number; p: number }> = [];

  await streamRows(filePath, (row) => {
    seen += 1;
    if (sampleEvery > 1 && seen % sampleEvery !== 0) return;

    const matchId = String(row.matchId ?? "");
    const bucket = hashToBucket(matchId, 10);
    const isVal = bucket === 0 || bucket === 1;
    if (!isVal) return;

    const y = toNumber(row.y) >= 0.5 ? 1 : 0;
    const x = names === FEATURE_NAMES_V4 ? featureVectorV4(row) : featureVector(row, names);
    const p = predict(w, x);

    ll += stableLogloss(y, p);
    const diff = p - y;
    brier += diff * diff;
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
    scores.push({ y, p });
    count += 1;
  });

  return {
    count,
    logloss: count > 0 ? ll / count : 0,
    brier: count > 0 ? brier / count : 0,
    accuracy: count > 0 ? correct / count : 0,
    auc: computeAUC(scores),
  };
}

async function main() {
  const candidatePaths = [
    path.join(process.cwd(), "training", "training_rows.jsonl"),
    path.join(process.cwd(), "training", "training_rows_v3.jsonl"),
  ];

  const filePath = candidatePaths.find((p) => fs.existsSync(p));
  if (!filePath) {
    throw new Error("No training rows file found. Expected training/training_rows.jsonl or training/training_rows_v3.jsonl");
  }

  const sampleEvery = Number(process.env.EVAL_SAMPLE_EVERY ?? "1");
  const epochs = Number(process.env.EVAL_EPOCHS ?? "4");
  const lr = Number(process.env.EVAL_LR ?? "0.03");
  const l2 = Number(process.env.EVAL_L2 ?? "0.0001");

  console.log("=== Quick v3 vs v4 evaluation ===");
  console.log(`file: ${filePath}`);
  console.log(`sampleEvery=${sampleEvery}, epochs=${epochs}, lr=${lr}, l2=${l2}`);
  console.log("split: group-by-match hash, validation buckets 0-1 (20%)");
  console.log();

  console.log("Training v3 baseline...");
  const w3 = await trainModel(filePath, FEATURE_NAMES_V3, { epochs, lr, l2, sampleEvery });

  console.log("Training v4 candidate...");
  const w4 = await trainModel(filePath, FEATURE_NAMES_V4, { epochs, lr, l2, sampleEvery });

  console.log("Evaluating on holdout...");
  const m3 = await evaluateModel(filePath, FEATURE_NAMES_V3, w3, sampleEvery);
  const m4 = await evaluateModel(filePath, FEATURE_NAMES_V4, w4, sampleEvery);

  console.log();
  console.log("Validation metrics");
  console.log(`Rows: ${m3.count}`);
  console.log("v3:", m3);
  console.log("v4:", m4);

  const deltaLogloss = m3.logloss - m4.logloss;
  const deltaBrier = m3.brier - m4.brier;
  const deltaAuc = m4.auc - m3.auc;
  const deltaAcc = m4.accuracy - m3.accuracy;

  console.log();
  console.log("Delta (v4 - v3, except where lower-is-better shown as v3-v4)");
  console.log(`logloss improvement (v3-v4): ${deltaLogloss.toFixed(6)}`);
  console.log(`brier improvement (v3-v4): ${deltaBrier.toFixed(6)}`);
  console.log(`auc change (v4-v3): ${deltaAuc.toFixed(6)}`);
  console.log(`accuracy change (v4-v3): ${deltaAcc.toFixed(6)}`);

  const improved = deltaLogloss > 0 && deltaBrier > 0;
  console.log();
  console.log(improved ? "✅ v4 shows improvement on this quick holdout." : "⚠️ v4 does not clearly beat v3 in this quick run.");
}

main().catch((e) => {
  console.error("Evaluation failed:", e);
  process.exit(1);
});
