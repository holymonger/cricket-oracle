/**
 * Monte Carlo innings simulator.
 *
 * Loads delivery probability tables (built by scripts/buildDeliveryTables.ts)
 * and simulates N innings from the current game state to produce outcome
 * distributions for market statement probability computations.
 *
 * Handles:
 *   - Innings 1: simulate until 120 legal balls or 10 wickets
 *   - Innings 2: simulate until target reached, 120 balls, or 10 wickets
 *   - Phase/wicket/pressure-conditioned delivery probabilities
 *   - Wide/no-ball (consume no legal ball, add runs)
 *   - Wickets independent of runs per delivery
 *
 * Performance: 5,000 simulations ≈ 20–60 ms (pure TypeScript, no I/O).
 */

import * as fs from "fs";
import * as path from "path";
import type { BucketProbs, DeliveryTables } from "@/scripts/buildDeliveryTables";

// ── Artifact loading (cached) ─────────────────────────────────────────────────

let _tables: DeliveryTables | null = null;

function loadTables(): DeliveryTables {
  if (_tables) return _tables;

  const candidates = [
    path.join(__dirname, "artifacts", "deliveryTables.json"),
    path.join(process.cwd(), "lib", "cricket", "artifacts", "deliveryTables.json"),
    path.resolve(__dirname, "..", "..", "lib", "cricket", "artifacts", "deliveryTables.json"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _tables = JSON.parse(fs.readFileSync(p, "utf-8")) as DeliveryTables;
      return _tables;
    }
  }

  throw new Error(
    "deliveryTables.json not found. Run: npm run build:delivery-tables"
  );
}

export function isDeliveryTablesAvailable(): boolean {
  try { loadTables(); return true; } catch { return false; }
}

// ── Bucket key helpers ────────────────────────────────────────────────────────

type Phase = "pp" | "mid" | "death";
type WktBucket = "0-2" | "3-4" | "5-6" | "7-9";
type PressureBucket = "none" | "low" | "med" | "high" | "extreme";

function getPhase(legalBall: number): Phase {
  if (legalBall <= 36) return "pp";
  if (legalBall <= 84) return "mid";
  return "death";
}

function getWktBucket(w: number): WktBucket {
  if (w <= 2) return "0-2";
  if (w <= 4) return "3-4";
  if (w <= 6) return "5-6";
  return "7-9";
}

function getPressureBucket(inningsNo: number, runsNeeded: number, ballsRem: number): PressureBucket {
  if (inningsNo !== 2 || ballsRem <= 0) return "none";
  const rrr = (runsNeeded * 6) / ballsRem;
  if (rrr < 7)  return "low";
  if (rrr < 10) return "med";
  if (rrr < 13) return "high";
  return "extreme";
}

function lookupBucket(tables: DeliveryTables, legalBall: number, wkts: number, inningsNo: number, runsNeeded: number, ballsRem: number): BucketProbs {
  const key = `${getPhase(legalBall)}:${getWktBucket(wkts)}:${getPressureBucket(inningsNo, runsNeeded, ballsRem)}`;
  return tables.tables[key] ?? tables.fallback;
}

// ── Fast seeded PRNG (xorshift32) ────────────────────────────────────────────

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return (): number => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ── Single delivery sampler ──────────────────────────────────────────────────

interface DeliveryResult {
  runs: number;         // runs added to score this delivery
  batRuns: number;      // bat runs only (for boundary tracking)
  isLegal: boolean;     // advances legal ball count
  isWicket: boolean;
  isFour: boolean;
  isSix: boolean;
}

function sampleDelivery(p: BucketProbs, rng: () => number): DeliveryResult {
  const r = rng();

  // First decide wide or no-ball (mutually exclusive)
  if (r < p.pWide) {
    // Wide: 1 run + possible extra bat runs (simplified: 1 run)
    return { runs: 1, batRuns: 0, isLegal: false, isWicket: false, isFour: false, isSix: false };
  }
  if (r < p.pWide + p.pNoBall) {
    // No-ball: 1 run penalty + bat runs (simplified: sample bat outcome)
    const r2 = rng();
    const cum = cumulativeLegal(p);
    const bat = sampleFromCumulative(r2, cum);
    return { runs: 1 + bat.runs, batRuns: bat.runs, isLegal: false, isWicket: false, isFour: bat.isFour, isSix: bat.isSix };
  }

  // Legal delivery
  const r2 = rng();
  const isWicket = r2 < p.pWicket;
  const r3 = rng();
  const cum = cumulativeLegal(p);
  const outcome = sampleFromCumulative(r3, cum);

  return {
    runs: outcome.runs,
    batRuns: outcome.runs,
    isLegal: true,
    isWicket,
    isFour: outcome.isFour,
    isSix: outcome.isSix,
  };
}

interface LegalOutcome { runs: number; isFour: boolean; isSix: boolean; }
interface CumulativeLegal { thresholds: number[]; outcomes: LegalOutcome[]; }

// Cache cumulative tables by BucketProbs reference
const _cumCache = new WeakMap<BucketProbs, CumulativeLegal>();

function cumulativeLegal(p: BucketProbs): CumulativeLegal {
  if (_cumCache.has(p)) return _cumCache.get(p)!;
  const outcomes: LegalOutcome[] = [
    { runs: 0, isFour: false, isSix: false },
    { runs: 1, isFour: false, isSix: false },
    { runs: 2, isFour: false, isSix: false },
    { runs: 3, isFour: false, isSix: false },
    { runs: 4, isFour: true,  isSix: false },
    { runs: 6, isFour: false, isSix: true  },
  ];
  const probs = [p.pDot, p.pOne, p.pTwo, p.pThree, p.pFour, p.pSix];
  const sum = probs.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  const thresholds = probs.map((v) => { cum += v / sum; return cum; });
  const result: CumulativeLegal = { thresholds, outcomes };
  _cumCache.set(p, result);
  return result;
}

function sampleFromCumulative(r: number, cum: CumulativeLegal): LegalOutcome {
  for (let i = 0; i < cum.thresholds.length; i++) {
    if (r < cum.thresholds[i]) return cum.outcomes[i];
  }
  return cum.outcomes[cum.outcomes.length - 1];
}

// ── Simulation state & result ─────────────────────────────────────────────────

export interface SimState {
  innings: 1 | 2;
  runs: number;
  wickets: number;
  /** Legal balls bowled so far (0–120) */
  balls: number;
  /** Innings 2 only: runs needed to win (target - runs scored already) */
  target?: number;
}

export interface InningsSim {
  finalRuns: number;
  foursScored: number;
  sixesScored: number;
  wicketsFallen: number;
  /** Innings 2: did the batting team win the chase? */
  wonChase: boolean;
}

// ── Core simulation ───────────────────────────────────────────────────────────

function simulateOne(state: SimState, tables: DeliveryTables, rng: () => number): InningsSim {
  let runs     = state.runs;
  let wickets  = state.wickets;
  let legalBall = state.balls;   // already-bowled legal balls
  let fours    = 0;
  let sixes    = 0;
  const inningsNo = state.innings;
  const targetRuns = state.target ?? 0; // innings 2 only

  while (legalBall < 120 && wickets < 10) {
    const runsNeeded = inningsNo === 2 ? Math.max(0, targetRuns - runs) : 0;
    if (inningsNo === 2 && runsNeeded <= 0) break; // already won

    const ballsRem = 120 - legalBall;
    const p = lookupBucket(tables, legalBall + 1, wickets, inningsNo, runsNeeded, ballsRem);
    const d = sampleDelivery(p, rng);

    runs += d.runs;
    if (d.isLegal) {
      legalBall++;
      if (d.isWicket) wickets++;
    }
    if (d.isFour) fours++;
    if (d.isSix)  sixes++;
  }

  const wonChase = inningsNo === 2 && runs >= targetRuns;

  return {
    finalRuns: runs,
    foursScored: fours,
    sixesScored: sixes,
    wicketsFallen: wickets - state.wickets,
    wonChase,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface MCResult {
  n: number;
  /** P(finalRuns >= threshold) */
  pRunsAtLeast: (threshold: number) => number;
  /** P(fours >= line) — *remaining* fours in this innings */
  pFoursAtLeast: (line: number) => number;
  /** P(sixes >= line) — *remaining* sixes in this innings */
  pSixesAtLeast: (line: number) => number;
  /** Innings 2 only: P(batting team wins chase) */
  pWin: number;
  /** Mean final runs */
  meanRuns: number;
  /** Standard deviation of final runs */
  sdRuns: number;
  /** Raw sims (available for custom queries) */
  sims: InningsSim[];
}

/**
 * Run N Monte Carlo simulations from the given match state.
 *
 * @param state   Current innings state (runs/wickets/balls already bowled)
 * @param n       Number of simulations (default 5000; 3000 is fine for 100ms budget)
 * @param seed    Random seed for reproducibility (default: time-based)
 */
export function simulate(state: SimState, n = 5000, seed?: number): MCResult {
  const tables = loadTables();
  const rng = makeRng(seed ?? (Date.now() & 0xffffffff));
  const sims: InningsSim[] = new Array(n);

  for (let i = 0; i < n; i++) {
    sims[i] = simulateOne(state, tables, rng);
  }

  let sumRuns = 0;
  let sumRuns2 = 0;
  let wins = 0;
  for (const s of sims) {
    sumRuns  += s.finalRuns;
    sumRuns2 += s.finalRuns * s.finalRuns;
    if (s.wonChase) wins++;
  }
  const meanRuns = sumRuns / n;
  const sdRuns   = Math.sqrt(Math.max(0, sumRuns2 / n - meanRuns * meanRuns));

  return {
    n,
    pRunsAtLeast: (threshold: number) => sims.filter((s) => s.finalRuns >= threshold).length / n,
    pFoursAtLeast: (line: number) => sims.filter((s) => s.foursScored >= line).length / n,
    pSixesAtLeast: (line: number) => sims.filter((s) => s.sixesScored >= line).length / n,
    pWin: wins / n,
    meanRuns,
    sdRuns,
    sims,
  };
}

/**
 * Simulate a full innings 1 from scratch, then simulate innings 2 chasing
 * the innings-1 total. Used for MATCH_TOTAL_RUNS markets before the match starts
 * or while innings 1 is in progress.
 *
 * Returns distributions for: innings1 total, innings2 total, match total.
 */
export interface FullMatchSim {
  innings1Sims: InningsSim[];
  innings2Sims: InningsSim[];
  /** P(match total runs >= line) */
  pMatchRunsAtLeast: (line: number) => number;
  /** P(match total fours >= line) */
  pMatchFoursAtLeast: (line: number) => number;
  /** P(match total sixes >= line) */
  pMatchSixesAtLeast: (line: number) => number;
  n: number;
}

export function simulateFullMatch(
  innings1State: SimState,
  n = 3000,
  seed?: number
): FullMatchSim {
  const tables = loadTables();
  const rng = makeRng(seed ?? (Date.now() & 0xffffffff));

  const innings1Sims: InningsSim[] = new Array(n);
  const innings2Sims: InningsSim[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const i1 = simulateOne(innings1State, tables, rng);
    innings1Sims[i] = i1;

    // Chase target = innings1 final runs + 1
    const chaseState: SimState = {
      innings: 2,
      runs: 0,
      wickets: 0,
      balls: 0,
      target: i1.finalRuns + 1,
    };
    innings2Sims[i] = simulateOne(chaseState, tables, rng);
  }

  return {
    innings1Sims,
    innings2Sims,
    pMatchRunsAtLeast: (line: number) =>
      innings1Sims.filter((s, i) => s.finalRuns + innings2Sims[i].finalRuns >= line).length / n,
    pMatchFoursAtLeast: (line: number) =>
      innings1Sims.filter((s, i) => s.foursScored + innings2Sims[i].foursScored >= line).length / n,
    pMatchSixesAtLeast: (line: number) =>
      innings1Sims.filter((s, i) => s.sixesScored + innings2Sims[i].sixesScored >= line).length / n,
    n,
  };
}
