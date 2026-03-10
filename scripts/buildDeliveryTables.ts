#!/usr/bin/env node
/**
 * Build delivery probability lookup tables from Cricsheet JSON files.
 *
 * Reads every match JSON in ipl_json + t20s_json, tallies per-delivery outcomes
 * into context buckets, and writes a static artifact used by the MC simulator.
 *
 * Buckets:
 *   phase:   "pp" (balls 1-36), "mid" (37-84), "death" (85-120)
 *   wkts:    "0-2", "3-4", "5-6", "7-9"  (wickets fallen before this ball)
 *   pressure: "low" (<7 rr needed), "med" (7-10), "high" (10-13), "extreme" (13+)
 *             Only used for innings 2; innings 1 uses "none".
 *
 * Output: lib/cricket/artifacts/deliveryTables.json  (~30-60 KB)
 *
 * Usage:
 *   npx tsx scripts/buildDeliveryTables.ts [--iplDir ../ipl_json] [--t20iDir ../t20s_json] [--fromYear 2021]
 */

import * as fs from "fs";
import * as path from "path";
import { resolveDatasetPaths } from "@/scripts/datasets/config";

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArg(args: string[], name: string): string | undefined {
  const idx = args.findIndex((a) => a === name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const args = process.argv.slice(2);
const datasetPaths = resolveDatasetPaths({
  iplDir: parseArg(args, "--iplDir"),
  t20iDir: parseArg(args, "--t20iDir"),
});
const fromYearRaw = parseArg(args, "--fromYear");
const fromYear = fromYearRaw ? parseInt(fromYearRaw, 10) : undefined;

const OUT_PATH = path.resolve(
  process.cwd(),
  "lib/cricket/artifacts/deliveryTables.json"
);

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "pp" | "mid" | "death";
type WktBucket = "0-2" | "3-4" | "5-6" | "7-9";
type PressureBucket = "none" | "low" | "med" | "high" | "extreme";

/** Raw tally counts per bucket — converted to probabilities at the end. */
interface BucketCounts {
  total: number;    // legal + illegal deliveries
  legal: number;    // legal balls (dot + scoring, excl wide/noball)
  dot: number;
  one: number;
  two: number;
  three: number;
  four: number;
  six: number;
  wide: number;     // wide (adds runs but no legal ball)
  noball: number;   // no-ball (adds runs but no legal ball)
  wicket: number;   // wicket on this delivery (independent of runs)
}

/** Probability distribution for one bucket (output artifact). */
export interface BucketProbs {
  /** Probability this legal delivery is: dot/1/2/3/4/6 */
  pDot: number;
  pOne: number;
  pTwo: number;
  pThree: number;
  pFour: number;
  pSix: number;
  /** Prob a wide occurs (consumes no legal ball, adds 1 run + runs off bat) */
  pWide: number;
  /** Prob a no-ball occurs (consumes no legal ball, adds 1 run + runs off bat) */
  pNoBall: number;
  /** Prob of wicket on this delivery (independent of runs) */
  pWicket: number;
  /** How many deliveries tallied (for confidence) */
  n: number;
}

/** The full artifact written to disk and loaded at runtime. */
export interface DeliveryTables {
  version: number;
  builtAt: string;
  fromYear: number | null;
  totalDeliveries: number;
  totalMatches: number;
  /** Key: `${phase}:${wkts}:${pressure}` */
  tables: Record<string, BucketProbs>;
  /** Fallback bucket averaged across all phases (used if bucket has < minN) */
  fallback: BucketProbs;
}

// ── Cricsheet JSON shape (minimal) ──────────────────────────────────────────

interface CricsheetDelivery {
  runs?: { batter?: number; extras?: number; total?: number };
  extras?: { wides?: number; noballs?: number; byes?: number; legbyes?: number };
  wickets?: unknown[];
}

interface CricsheetOver {
  over?: number;
  deliveries?: CricsheetDelivery[];
}

interface CricsheetInnings {
  team?: string;
  overs?: CricsheetOver[];
}

interface CricsheetMatch {
  info?: {
    dates?: string[];
    teams?: string[];
    outcome?: { winner?: string };
  };
  innings?: CricsheetInnings[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPhase(legalBall: number): Phase {
  // legalBall is 1-indexed (1=first ball of innings)
  if (legalBall <= 36) return "pp";
  if (legalBall <= 84) return "mid";
  return "death";
}

function getWktBucket(wicketsFallen: number): WktBucket {
  if (wicketsFallen <= 2) return "0-2";
  if (wicketsFallen <= 4) return "3-4";
  if (wicketsFallen <= 6) return "5-6";
  return "7-9";
}

function getPressureBucket(
  inningsNo: number,
  runsNeeded: number,
  ballsRemaining: number
): PressureBucket {
  if (inningsNo !== 2 || ballsRemaining <= 0) return "none";
  const rrr = (runsNeeded * 6) / ballsRemaining;
  if (rrr < 7) return "low";
  if (rrr < 10) return "med";
  if (rrr < 13) return "high";
  return "extreme";
}

function bucketKey(phase: Phase, wkts: WktBucket, pressure: PressureBucket): string {
  return `${phase}:${wkts}:${pressure}`;
}

function emptyBucketCounts(): BucketCounts {
  return { total: 0, legal: 0, dot: 0, one: 0, two: 0, three: 0, four: 0, six: 0, wide: 0, noball: 0, wicket: 0 };
}

function toProbs(c: BucketCounts): BucketProbs {
  const denom = c.legal > 0 ? c.legal : 1;
  const totalDenom = c.total > 0 ? c.total : 1;
  return {
    pDot:    c.dot    / denom,
    pOne:    c.one    / denom,
    pTwo:    c.two    / denom,
    pThree:  c.three  / denom,
    pFour:   c.four   / denom,
    pSix:    c.six    / denom,
    pWide:   c.wide   / totalDenom,
    pNoBall: c.noball / totalDenom,
    pWicket: c.wicket / denom,
    n: c.total,
  };
}

function mergeCounts(a: BucketCounts, b: BucketCounts): BucketCounts {
  return {
    total:  a.total  + b.total,
    legal:  a.legal  + b.legal,
    dot:    a.dot    + b.dot,
    one:    a.one    + b.one,
    two:    a.two    + b.two,
    three:  a.three  + b.three,
    four:   a.four   + b.four,
    six:    a.six    + b.six,
    wide:   a.wide   + b.wide,
    noball: a.noball + b.noball,
    wicket: a.wicket + b.wicket,
  };
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

// ── Min deliveries before we trust a bucket; otherwise blend with fallback ──
const MIN_N = 500;

function blendWithFallback(bucket: BucketCounts, fallback: BucketCounts): BucketProbs {
  if (bucket.total >= MIN_N) return toProbs(bucket);
  // Linear blend: 0 data → pure fallback, MIN_N data → pure bucket
  const w = bucket.total / MIN_N;
  const fb = toProbs(fallback);
  const bk = toProbs(bucket);
  return {
    pDot:    w * bk.pDot    + (1 - w) * fb.pDot,
    pOne:    w * bk.pOne    + (1 - w) * fb.pOne,
    pTwo:    w * bk.pTwo    + (1 - w) * fb.pTwo,
    pThree:  w * bk.pThree  + (1 - w) * fb.pThree,
    pFour:   w * bk.pFour   + (1 - w) * fb.pFour,
    pSix:    w * bk.pSix    + (1 - w) * fb.pSix,
    pWide:   w * bk.pWide   + (1 - w) * fb.pWide,
    pNoBall: w * bk.pNoBall + (1 - w) * fb.pNoBall,
    pWicket: w * bk.pWicket + (1 - w) * fb.pWicket,
    n: bucket.total,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allDirs = [
    { dir: datasetPaths.iplDir,  label: "ipl" },
    { dir: datasetPaths.t20iDir, label: "t20i" },
  ];

  const counts = new Map<string, BucketCounts>();
  const fallbackCounts = emptyBucketCounts();

  let totalMatches = 0;
  let totalDeliveries = 0;
  let skipped = 0;

  for (const { dir, label } of allDirs) {
    const files = listJsonFiles(dir);
    console.log(`\n${label}: ${files.length} files in ${dir}`);

    for (const filePath of files) {
      let data: CricsheetMatch;
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch { skipped++; continue; }

      const dateStr = data.info?.dates?.[0];
      if (fromYear && dateStr) {
        const yr = parseInt(dateStr.slice(0, 4), 10);
        if (yr < fromYear) continue;
      }

      const teams = data.info?.teams ?? [];
      if (teams.length < 2 || !data.info?.outcome?.winner) { skipped++; continue; }

      const innings = data.innings ?? [];
      if (innings.length < 2) { skipped++; continue; }

      totalMatches++;

      // Compute innings 1 total for calculating target in innings 2
      let innings1Total = 0;
      for (const inning of innings.slice(0, 1)) {
        for (const over of inning.overs ?? []) {
          for (const d of over.deliveries ?? []) {
            innings1Total += d.runs?.total ?? 0;
          }
        }
      }
      const target = innings1Total + 1; // runs needed to win innings 2

      for (let inningsIdx = 0; inningsIdx < Math.min(2, innings.length); inningsIdx++) {
        const inningsNo = inningsIdx + 1;
        const inning = innings[inningsIdx];
        let legalBall = 0;
        let wicketsFallen = 0;
        let runsScored = 0;

        for (const over of inning.overs ?? []) {
          for (const d of over.deliveries ?? []) {
            const extras = d.extras ?? {};
            const isWide   = (extras.wides   ?? 0) > 0;
            const isNoBall = (extras.noballs  ?? 0) > 0;
            const isIllegal = isWide || isNoBall;
            const batRuns  = d.runs?.batter ?? 0;
            const extraRuns = d.runs?.extras ?? 0;
            const totalRuns = d.runs?.total ?? 0;
            const isWicket = Array.isArray(d.wickets) && d.wickets.length > 0;

            totalDeliveries++;

            if (!isIllegal) legalBall++;

            const phase    = getPhase(legalBall);
            const wkts     = getWktBucket(wicketsFallen);
            const runsNeeded = inningsNo === 2 ? target - runsScored : 0;
            const ballsRem   = inningsNo === 2 ? Math.max(0, 120 - legalBall) : 0;
            const pressure  = getPressureBucket(inningsNo, runsNeeded, ballsRem);

            const key = bucketKey(phase, wkts, pressure);
            if (!counts.has(key)) counts.set(key, emptyBucketCounts());
            const c = counts.get(key)!;

            c.total++;
            fallbackCounts.total++;

            if (isWide) {
              c.wide++;
              fallbackCounts.wide++;
            } else if (isNoBall) {
              c.noball++;
              fallbackCounts.noball++;
            } else {
              // Legal delivery
              c.legal++;
              fallbackCounts.legal++;
              if (batRuns === 0 && !isWicket) { c.dot++;    fallbackCounts.dot++; }
              else if (batRuns === 1)           { c.one++;    fallbackCounts.one++; }
              else if (batRuns === 2)           { c.two++;    fallbackCounts.two++; }
              else if (batRuns === 3)           { c.three++;  fallbackCounts.three++; }
              else if (batRuns === 4)           { c.four++;   fallbackCounts.four++; }
              else if (batRuns === 6)           { c.six++;    fallbackCounts.six++; }
              // batRuns 0 + wicket → dot + wicket (separate)
              if (isWicket) { c.wicket++; fallbackCounts.wicket++; }
            }

            runsScored += totalRuns;
            if (isWicket && !isIllegal) wicketsFallen++;
          }
        }
      }
    }
  }

  console.log(`\nTotal matches processed: ${totalMatches}`);
  console.log(`Total deliveries: ${totalDeliveries.toLocaleString()}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Buckets: ${counts.size}`);

  // Print bucket summary
  console.log("\nBucket summary (n = deliveries):");
  for (const [key, c] of [...counts.entries()].sort()) {
    console.log(`  ${key.padEnd(30)} n=${c.total.toLocaleString().padStart(8)} legal=${c.legal.toLocaleString().padStart(8)}`);
  }

  // Build output artifact — blend sparse buckets with fallback
  const tables: Record<string, BucketProbs> = {};
  for (const [key, c] of counts) {
    tables[key] = blendWithFallback(c, fallbackCounts);
  }

  const artifact: DeliveryTables = {
    version: 1,
    builtAt: new Date().toISOString(),
    fromYear: fromYear ?? null,
    totalDeliveries,
    totalMatches,
    tables,
    fallback: toProbs(fallbackCounts),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2), "utf-8");
  const sizeKB = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log(`\nWritten: ${OUT_PATH} (${sizeKB} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
