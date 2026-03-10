import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

type Row = {
  matchKey?: string;
  innings?: number;
  battingTeam?: "A" | "B";
  y?: number;
  features?: Record<string, number>;
};

type V43Artifact = {
  modelVersion: "v43-logreg";
  featureNames: string[];
  standardize: boolean;
  mean: number[];
  std: number[];
  intercept: number;
  coeff: number[];
};

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function parseArg(args: string[], name: string): string | undefined {
  const idx = args.findIndex((a) => a === name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function loadArtifact(modelPath: string): V43Artifact {
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model artifact not found: ${modelPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(modelPath, "utf-8")) as V43Artifact;
  if (parsed.modelVersion !== "v43-logreg") {
    throw new Error(`Expected v43-logreg artifact, got ${parsed.modelVersion}`);
  }
  return parsed;
}

function predictRaw(model: V43Artifact, features: Record<string, number>): number {
  const x = model.featureNames.map((name) => toNum(features[name]));

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

async function main() {
  const args = process.argv.slice(2);
  const dataPath = path.resolve(
    process.cwd(),
    parseArg(args, "--data") ?? "training/training_rows_v43_stratified.jsonl"
  );
  const modelPath = path.resolve(
    process.cwd(),
    parseArg(args, "--model") ?? "lib/model/artifacts/v43_logreg.json"
  );

  const model = loadArtifact(modelPath);
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data not found: ${dataPath}`);
  }

  const rows: Array<{ matchKey: string; battingTeam: string; y: number; rawPred: number; pressure: number; ballsRemaining: number }> = [];
  const stream = fs.createReadStream(dataPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (rows.length >= 20) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Row;
      const features = row.features ?? {};
      const innings = Number(row.innings ?? 0);
      const ballsRemaining = toNum(features.ballsRemaining);
      const pressure = toNum(features.pressure);
      if (innings !== 2 || ballsRemaining > 6 || pressure < 2.5) {
        continue;
      }

      const rawPred = predictRaw(model, features);
      rows.push({
        matchKey: String(row.matchKey ?? ""),
        battingTeam: String(row.battingTeam ?? "?"),
        y: toNum(row.y) >= 0.5 ? 1 : 0,
        rawPred,
        pressure,
        ballsRemaining,
      });
    } catch {
      continue;
    }
  }

  console.log("=== Sanity Orientation (late chase, high pressure) ===");
  console.log(`data=${dataPath}`);
  console.log(`model=${modelPath}`);
  console.log("matchKey\tbattingTeam\ty\tballsRem\tpressure\trawPred");
  for (const r of rows) {
    console.log(
      `${r.matchKey}\t${r.battingTeam}\t${r.y}\t${r.ballsRemaining}\t${r.pressure.toFixed(3)}\t${r.rawPred.toFixed(4)}`
    );
  }

  const bySide = {
    A: rows.filter((r) => r.battingTeam === "A"),
    B: rows.filter((r) => r.battingTeam === "B"),
  };
  const avg = (arr: typeof rows) =>
    arr.length > 0 ? arr.reduce((s, r) => s + r.rawPred, 0) / arr.length : 0;

  console.log("\nAverage rawPred by batting team in sample:");
  console.log(`A: n=${bySide.A.length} avgRawPred=${avg(bySide.A).toFixed(4)}`);
  console.log(`B: n=${bySide.B.length} avgRawPred=${avg(bySide.B).toFixed(4)}`);
}

main().catch((err) => {
  console.error("sanity:orientation failed:", err);
  process.exit(1);
});
