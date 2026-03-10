#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { buildV4Features } from "@/lib/features/buildV4Features";
import { buildV41Features } from "@/lib/features/buildV41Features";
import { buildV42Features } from "@/lib/features/buildV42Features";
import { buildV43Features } from "@/lib/features/buildV43Features";
import { FEATURE_NAMES_V4 } from "@/lib/features/featureSchemaV4";
import { FEATURE_NAMES_V41 } from "@/lib/features/featureSchemaV41";
import { FEATURE_NAMES_V42 } from "@/lib/features/featureSchemaV42";
import { FEATURE_NAMES_V43 } from "@/lib/features/featureSchemaV43";
import { resolveDatasetPaths } from "@/scripts/datasets/config";

type Competition = "ipl" | "t20i";
type FeatureVersion = "v4" | "v41" | "v42" | "v43";
type SamplingMode = "stratified" | "every-n";

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

type BallsRemainingBand = (typeof BALLS_REMAINING_BANDS)[number]["key"];

type ExportOptions = {
  iplDir?: string;
  t20iDir?: string;
  out: string;
  featureVersion: FeatureVersion;
  maxMatches?: number;
  seed: number;
  sampleEveryBalls: number;
  sampling: SamplingMode;
  maxPerBandPerMatch: number;
  alwaysIncludeLastBalls: number;
  includeCompetitions: Set<Competition>;
  balancedByCompetition: boolean;
  fromYear?: number;  // only include matches on/after this year (e.g. 2021)
};

type FileTask = {
  competition: Competition;
  filePath: string;
};

type CricsheetMatch = {
  info?: {
    teams?: string[];
    outcome?: {
      winner?: string;
      result?: string;
    };
  };
  innings?: Array<{
    team?: string;
    overs?: Array<{
      over?: number;
      deliveries?: Array<{
        runs?: {
          batter?: number;
          total?: number;
        };
        extras?: {
          wides?: number;
          noballs?: number;
          byes?: number;
          legbyes?: number;
          penalty?: number;
        };
        wickets?: Array<unknown>;
      }>;
    }>;
  }>;
};

type CricsheetInnings = NonNullable<CricsheetMatch["innings"]>[number];

type ExportRow = {
  matchKey: string;
  matchId: string | null;
  competition: Competition;
  ballKey: string;
  innings: 1 | 2;
  legalBallNumber: number;
  battingTeam: "A" | "B";
  y: 0 | 1;
  features: Record<string, number>;
};

type ExportStats = {
  matchesTotal: number;
  matchesParsed: number;
  matchesSkippedNoResult: number;
  inningsSkipped: number;
  rowsWritten: number;
  rowsInvalid: number;
  rowsSampledOut: number;
  rowsPerInnings: Record<"1" | "2", number>;
  rowsPerBand: Record<BallsRemainingBand, number>;
  candidatesPerBand: Record<BallsRemainingBand, number>;
  parserErrors: number;
  skipReasons: Record<string, number>;
};

type CandidateRow = {
  row: ExportRow;
  legalBallNumber: number;
  band: BallsRemainingBand;
};

type BallSnapshot = {
  runsTotal: number;
  isWicket: boolean;
  isBoundary: boolean;
};

function toNum(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace<T>(items: T[], seed: number): void {
  const rnd = seededRandom(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function parseArgValue(args: string[], name: string): string | undefined {
  const idx = args.findIndex((arg) => arg === name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function hasArg(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseOptions(): ExportOptions {
  const args = process.argv.slice(2);

  const featureVersionRaw = (parseArgValue(args, "--featureVersion") ?? "v4").toLowerCase();
  if (featureVersionRaw !== "v4" && featureVersionRaw !== "v41" && featureVersionRaw !== "v42" && featureVersionRaw !== "v43") {
    throw new Error(`Invalid --featureVersion value: ${featureVersionRaw}. Expected v4, v41, v42, or v43`);
  }
  const featureVersion = featureVersionRaw as FeatureVersion;

  const outDefault = featureVersion === "v43"
    ? "training/training_rows_v43_stratified.jsonl"
    : featureVersion === "v42"
    ? "training/training_rows_v42_stratified.jsonl"
    : featureVersion === "v41"
    ? "training/training_rows_v41.jsonl"
    : "training/training_rows_v4.jsonl";
  const out = parseArgValue(args, "--out") ?? outDefault;
  const maxMatchesRaw = parseArgValue(args, "--maxMatches");
  const seedRaw = parseArgValue(args, "--seed") ?? "42";
  const sampleRaw = parseArgValue(args, "--sampleEveryBalls") ?? "6";
  const samplingRaw = (parseArgValue(args, "--sampling") ?? "stratified").toLowerCase();
  const maxPerBandRaw = parseArgValue(args, "--maxPerBandPerMatch") ?? "8";
  const alwaysIncludeLastBallsRaw = parseArgValue(args, "--alwaysIncludeLastBalls") ?? "12";
  const includeRaw = parseArgValue(args, "--includeCompetitions") ?? "ipl,t20i";
  const balancedByCompetition = hasArg(args, "--balancedByCompetition");

  const includeCompetitions = new Set<Competition>();
  for (const piece of includeRaw.split(",").map((p) => p.trim().toLowerCase())) {
    if (piece === "ipl" || piece === "t20i") {
      includeCompetitions.add(piece);
    }
  }

  if (includeCompetitions.size === 0) {
    throw new Error("--includeCompetitions must include at least one of: ipl,t20i");
  }

  const seed = Number(seedRaw);
  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid --seed value: ${seedRaw}`);
  }

  const sampleEveryBalls = Number(sampleRaw);
  if (!Number.isFinite(sampleEveryBalls) || sampleEveryBalls < 1) {
    throw new Error(`Invalid --sampleEveryBalls value: ${sampleRaw}`);
  }

  if (samplingRaw !== "stratified" && samplingRaw !== "every-n") {
    throw new Error(`Invalid --sampling value: ${samplingRaw}. Expected stratified or every-n`);
  }
  const sampling = samplingRaw as SamplingMode;

  const maxPerBandPerMatch = Number(maxPerBandRaw);
  if (!Number.isFinite(maxPerBandPerMatch) || maxPerBandPerMatch < 1) {
    throw new Error(`Invalid --maxPerBandPerMatch value: ${maxPerBandRaw}`);
  }

  const alwaysIncludeLastBalls = Number(alwaysIncludeLastBallsRaw);
  if (!Number.isFinite(alwaysIncludeLastBalls) || alwaysIncludeLastBalls < 0) {
    throw new Error(`Invalid --alwaysIncludeLastBalls value: ${alwaysIncludeLastBallsRaw}`);
  }

  let maxMatches: number | undefined;
  if (maxMatchesRaw !== undefined) {
    const parsed = Number(maxMatchesRaw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`Invalid --maxMatches value: ${maxMatchesRaw}`);
    }
    maxMatches = Math.floor(parsed);
  }

  const fromYearRaw = parseArgValue(args, "--fromYear");
  let fromYear: number | undefined;
  if (fromYearRaw !== undefined) {
    const parsed = Number(fromYearRaw);
    if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) {
      throw new Error(`Invalid --fromYear value: ${fromYearRaw}. Expected a year like 2021`);
    }
    fromYear = Math.floor(parsed);
  }

  return {
    iplDir: parseArgValue(args, "--iplDir"),
    t20iDir: parseArgValue(args, "--t20iDir"),
    out,
    featureVersion,
    maxMatches,
    seed,
    sampleEveryBalls: Math.floor(sampleEveryBalls),
    sampling,
    maxPerBandPerMatch: Math.floor(maxPerBandPerMatch),
    alwaysIncludeLastBalls: Math.floor(alwaysIncludeLastBalls),
    includeCompetitions,
    balancedByCompetition,
    fromYear,
  };
}

function ensureDirExists(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function incReason(stats: ExportStats, reason: string): void {
  stats.skipReasons[reason] = (stats.skipReasons[reason] ?? 0) + 1;
}

function listJsonFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(dirPath, name));
}

function normalizeTeams(rawA: string, rawB: string): { teamA: string; teamB: string } {
  if (rawA.localeCompare(rawB) <= 0) {
    return { teamA: rawA, teamB: rawB };
  }
  return { teamA: rawB, teamB: rawA };
}

function getWinnerSide(rawWinner: string, teamA: string, teamB: string): "A" | "B" | null {
  if (rawWinner === teamA) return "A";
  if (rawWinner === teamB) return "B";
  return null;
}

function parseMatchFile(filePath: string): CricsheetMatch {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as CricsheetMatch;
}

function sumInningsRuns(innings: CricsheetInnings): number {
  const overs = innings?.overs ?? [];
  let total = 0;
  for (const over of overs) {
    for (const delivery of over.deliveries ?? []) {
      total += toNum(delivery.runs?.total);
    }
  }
  return total;
}

function validateFeatureObject(features: Record<string, number>, featureNames: readonly string[]): boolean {
  for (const key of featureNames) {
    if (!(key in features)) return false;
    if (!Number.isFinite(features[key])) return false;
  }
  return true;
}

function initBandCounts(): Record<BallsRemainingBand, number> {
  return {
    band0: 0,
    band1: 0,
    band2: 0,
    band3: 0,
    band4: 0,
    band5: 0,
    band6: 0,
    band7: 0,
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

function pickUniformSpaced<T>(items: T[], k: number): T[] {
  if (k <= 0 || items.length === 0) return [];
  if (k >= items.length) return [...items];

  const selectedIndices = new Set<number>();
  for (let i = 0; i < k; i++) {
    const candidate = Math.floor(((i + 0.5) * items.length) / k);
    let idx = Math.max(0, Math.min(items.length - 1, candidate));

    // Keep samples spread across innings while avoiding duplicate indices.
    if (selectedIndices.has(idx)) {
      let left = idx - 1;
      let right = idx + 1;
      while (left >= 0 || right < items.length) {
        if (right < items.length && !selectedIndices.has(right)) {
          idx = right;
          break;
        }
        if (left >= 0 && !selectedIndices.has(left)) {
          idx = left;
          break;
        }
        right += 1;
        left -= 1;
      }
    }

    selectedIndices.add(idx);
  }

  return Array.from(selectedIndices.values())
    .sort((a, b) => a - b)
    .map((idx) => items[idx]);
}

function selectRowsForInnings(candidates: CandidateRow[], options: ExportOptions): CandidateRow[] {
  if (options.sampling === "every-n") {
    if (options.sampleEveryBalls <= 1) return [...candidates];
    return candidates.filter((c) => c.legalBallNumber % options.sampleEveryBalls === 0);
  }

  if (candidates.length === 0) return [];

  const selected = new Set<number>();
  const start = Math.max(0, candidates.length - options.alwaysIncludeLastBalls);
  for (let i = start; i < candidates.length; i++) {
    selected.add(i);
  }

  const remainingByBand = new Map<BallsRemainingBand, Array<{ idx: number; row: CandidateRow }>>();
  for (let i = 0; i < candidates.length; i++) {
    if (selected.has(i)) continue;
    const c = candidates[i];
    const list = remainingByBand.get(c.band) ?? [];
    list.push({ idx: i, row: c });
    remainingByBand.set(c.band, list);
  }

  for (const band of BALLS_REMAINING_BANDS) {
    const list = remainingByBand.get(band.key) ?? [];
    const take = Math.min(options.maxPerBandPerMatch, list.length);
    const picked = pickUniformSpaced(list, take);
    for (const item of picked) {
      selected.add(item.idx);
    }
  }

  return candidates.filter((_, idx) => selected.has(idx));
}

async function exportRows(options: ExportOptions): Promise<ExportStats> {
  const featureNames =
    options.featureVersion === "v43"
      ? FEATURE_NAMES_V43
      : options.featureVersion === "v42"
      ? FEATURE_NAMES_V42
      : options.featureVersion === "v41"
      ? FEATURE_NAMES_V41
      : FEATURE_NAMES_V4;

  const datasetPaths = resolveDatasetPaths({
    iplDir: options.iplDir,
    t20iDir: options.t20iDir,
  });

  const stats: ExportStats = {
    matchesTotal: 0,
    matchesParsed: 0,
    matchesSkippedNoResult: 0,
    inningsSkipped: 0,
    rowsWritten: 0,
    rowsInvalid: 0,
    rowsSampledOut: 0,
    rowsPerInnings: { "1": 0, "2": 0 },
    rowsPerBand: initBandCounts(),
    candidatesPerBand: initBandCounts(),
    parserErrors: 0,
    skipReasons: {},
  };

  const tasks: FileTask[] = [];
  if (options.includeCompetitions.has("ipl")) {
    for (const filePath of listJsonFiles(datasetPaths.iplDir)) {
      tasks.push({ competition: "ipl", filePath });
    }
  }
  if (options.includeCompetitions.has("t20i")) {
    for (const filePath of listJsonFiles(datasetPaths.t20iDir)) {
      tasks.push({ competition: "t20i", filePath });
    }
  }

  let selectedTasks: FileTask[];
  if (options.balancedByCompetition && options.maxMatches && options.includeCompetitions.size > 1) {
    const byCompetition = new Map<Competition, FileTask[]>();
    for (const task of tasks) {
      const list = byCompetition.get(task.competition) ?? [];
      list.push(task);
      byCompetition.set(task.competition, list);
    }

    for (const [competition, list] of byCompetition.entries()) {
      const compSeed = options.seed + (competition === "ipl" ? 101 : 202);
      shuffleInPlace(list, compSeed);
    }

    const competitions = Array.from(options.includeCompetitions.values()).sort();
    const basePerCompetition = Math.floor(options.maxMatches / competitions.length);
    let remainder = options.maxMatches % competitions.length;

    selectedTasks = [];
    for (const competition of competitions) {
      const available = byCompetition.get(competition) ?? [];
      const take = Math.min(available.length, basePerCompetition + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
      selectedTasks.push(...available.slice(0, take));
    }

    if (selectedTasks.length < options.maxMatches) {
      const selectedPaths = new Set(selectedTasks.map((t) => t.filePath));
      const leftovers = tasks.filter((t) => !selectedPaths.has(t.filePath));
      shuffleInPlace(leftovers, options.seed + 999);
      selectedTasks.push(...leftovers.slice(0, options.maxMatches - selectedTasks.length));
    }
  } else {
    shuffleInPlace(tasks, options.seed);
    selectedTasks = options.maxMatches ? tasks.slice(0, options.maxMatches) : tasks;
  }

  selectedTasks.sort((a, b) => a.filePath.localeCompare(b.filePath));

  const selectedByCompetition = new Map<Competition, number>();
  for (const task of selectedTasks) {
    selectedByCompetition.set(task.competition, (selectedByCompetition.get(task.competition) ?? 0) + 1);
  }
  for (const [competition, count] of selectedByCompetition.entries()) {
    console.log(`selected[${competition}]=${count}`);
  }
  if (options.fromYear !== undefined) {
    console.log(`fromYear=${options.fromYear} (matches before this year will be skipped)`);
  }

  stats.matchesTotal = selectedTasks.length;

  const outPath = path.resolve(process.cwd(), options.out);
  ensureDirExists(path.dirname(outPath));

  const writer = fs.createWriteStream(outPath, { encoding: "utf-8" });

  try {
    for (let i = 0; i < selectedTasks.length; i++) {
      const task = selectedTasks[i];
      const matchKey = path.basename(task.filePath, ".json");

      let parsed: CricsheetMatch;
      try {
        parsed = parseMatchFile(task.filePath);
      } catch {
        stats.parserErrors += 1;
        incReason(stats, "parserError");
        continue;
      }

      const teams = parsed.info?.teams ?? [];
      if (teams.length < 2 || !teams[0] || !teams[1]) {
        incReason(stats, "missingTeams");
        continue;
      }

      // Year filter — skip matches before --fromYear
      if (options.fromYear !== undefined) {
        const dateStr: string | undefined = (parsed.info as any)?.dates?.[0];
        const matchYear = dateStr ? parseInt(dateStr.slice(0, 4), 10) : NaN;
        if (!Number.isFinite(matchYear) || matchYear < options.fromYear) {
          incReason(stats, "beforeFromYear");
          continue;
        }
      }

      const winner = parsed.info?.outcome?.winner;
      if (!winner) {
        stats.matchesSkippedNoResult += 1;
        incReason(stats, "missingWinner");
        continue;
      }

      const { teamA, teamB } = normalizeTeams(teams[0], teams[1]);
      const winnerSide = getWinnerSide(winner, teamA, teamB);
      if (!winnerSide) {
        stats.matchesSkippedNoResult += 1;
        incReason(stats, "winnerNotInTeams");
        continue;
      }

      const innings = parsed.innings ?? [];
      if (innings.length < 2) {
        incReason(stats, "missingSecondInnings");
        continue;
      }

      stats.matchesParsed += 1;

      const innings1Total = sumInningsRuns(innings[0]);

      for (let inningsIndex = 0; inningsIndex < Math.min(2, innings.length); inningsIndex++) {
        const inningsNo = (inningsIndex + 1) as 1 | 2;
        const inningsData = innings[inningsIndex];
        const battingTeamName = inningsData.team;
        if (!battingTeamName) {
          stats.inningsSkipped += 1;
          incReason(stats, "missingBattingTeam");
          continue;
        }

        const battingTeam: "A" | "B" = battingTeamName === teamA ? "A" : "B";
        // Label: did the batting team win? This is consistent regardless of alphabetical
        // normalization — the model learns "will this batting side win?" from game state.
        const y: 0 | 1 = winnerSide === battingTeam ? 1 : 0;
        const overs = inningsData.overs ?? [];
        let runs = 0;
        let wickets = 0;
        let balls = 0;
        const history: BallSnapshot[] = [];
        const candidateRows: CandidateRow[] = [];

        for (const over of overs) {
          for (const delivery of over.deliveries ?? []) {
            const runsTotal = toNum(delivery.runs?.total);
            const runsBat = toNum(delivery.runs?.batter);
            const extras = delivery.extras ?? {};
            const isWide = toNum(extras.wides) > 0;
            const isNoBall = toNum(extras.noballs) > 0;
            const isLegal = !isWide && !isNoBall;

            const wicketCount = (delivery.wickets ?? []).length;
            const isWicket = wicketCount > 0;
            const isBoundary = runsBat === 4 || runsBat === 6;

            runs += runsTotal;
            wickets += wicketCount;
            if (isLegal) {
              balls += 1;
            }

            if (!isLegal) {
              continue;
            }

            const legalBallNumber = balls;
            const last6 = history.slice(Math.max(0, history.length - 6));
            const last12 = history.slice(Math.max(0, history.length - 12));

            const runsLast6 = last6.reduce((sum, item) => sum + item.runsTotal, 0);
            const wktsLast6 = last6.filter((item) => item.isWicket).length;
            const dotsLast6 = last6.filter((item) => item.runsTotal === 0).length;
            const boundariesLast6 = last6.filter((item) => item.isBoundary).length;

            const runsLast12 = last12.reduce((sum, item) => sum + item.runsTotal, 0);
            const wktsLast12 = last12.filter((item) => item.isWicket).length;
            const dotsLast12 = last12.filter((item) => item.runsTotal === 0).length;
            const boundariesLast12 = last12.filter((item) => item.isBoundary).length;

            const targetRuns = inningsNo === 2 ? innings1Total + 1 : undefined;
            if (inningsNo === 2 && !Number.isFinite(targetRuns)) {
              stats.rowsInvalid += 1;
              incReason(stats, "targetMissingInInnings2");
              history.push({ runsTotal, isWicket, isBoundary });
              continue;
            }

            const ballContext = {
              innings: inningsNo,
              battingTeam,
              runs,
              wickets,
              balls,
              targetRuns,
              runsThisBall: runsTotal,
              isWicketThisBall: isWicket,
            };

            const rolling = {
              runsLast6,
              wktsLast6,
              dotsLast6,
              boundariesLast6,
              runsLast12,
              wktsLast12,
              dotsLast12,
              boundariesLast12,
            };

            const features = (
              options.featureVersion === "v43"
                ? buildV43Features({ teamA, teamB }, ballContext, rolling)
                : options.featureVersion === "v42"
                ? buildV42Features({ teamA, teamB }, ballContext, rolling)
                : options.featureVersion === "v41"
                ? buildV41Features({ teamA, teamB }, ballContext, rolling)
                : buildV4Features({ teamA, teamB }, ballContext, rolling)
            ) as Record<string, number>;

            // Keep batting side explicitly in feature payload for orientation sanity checks.
            features.battingTeamIsA = battingTeam === "A" ? 1 : 0;

            if (!validateFeatureObject(features, featureNames)) {
              stats.rowsInvalid += 1;
              incReason(stats, "invalidFeatures");
              history.push({ runsTotal, isWicket, isBoundary });
              continue;
            }

            if (y !== 0 && y !== 1) {
              stats.rowsInvalid += 1;
              incReason(stats, "invalidLabel");
              history.push({ runsTotal, isWicket, isBoundary });
              continue;
            }

            const row: ExportRow = {
              matchKey,
              matchId: null,
              competition: task.competition,
              ballKey: `${inningsNo}.${legalBallNumber}`,
              innings: inningsNo,
              legalBallNumber,
              battingTeam,
              y,
              features,
            };

            const band = getBallsRemainingBand(features.ballsRemaining);
            stats.candidatesPerBand[band] += 1;
            candidateRows.push({ row, legalBallNumber, band });

            history.push({ runsTotal, isWicket, isBoundary });
          }
        }

        const selectedRows = selectRowsForInnings(candidateRows, options);
        stats.rowsSampledOut += Math.max(0, candidateRows.length - selectedRows.length);

        for (const selected of selectedRows) {
          writer.write(`${JSON.stringify(selected.row)}\n`);
          stats.rowsWritten += 1;
          stats.rowsPerInnings[String(inningsNo) as "1" | "2"] += 1;
          stats.rowsPerBand[selected.band] += 1;
        }
      }

      if ((i + 1) % 250 === 0 || i + 1 === selectedTasks.length) {
        console.log(
          `Progress ${i + 1}/${selectedTasks.length} | parsed=${stats.matchesParsed} rows=${stats.rowsWritten} invalid=${stats.rowsInvalid}`
        );
      }
    }
  } finally {
    await new Promise<void>((resolve) => writer.end(resolve));
  }

  return stats;
}

function printSummary(options: ExportOptions, stats: ExportStats): void {
  console.log(`\n=== Export Summary (${options.featureVersion} combined) ===`);
  console.log(`matchesTotal: ${stats.matchesTotal}`);
  console.log(`matchesParsed: ${stats.matchesParsed}`);
  console.log(`matchesSkippedNoResult: ${stats.matchesSkippedNoResult}`);
  console.log(`inningsSkipped: ${stats.inningsSkipped}`);
  console.log(`rowsWritten: ${stats.rowsWritten}`);
  console.log(`rowsInvalid: ${stats.rowsInvalid}`);
  console.log(`rowsSampledOut: ${stats.rowsSampledOut}`);
  console.log(`rowsPerInnings[1]: ${stats.rowsPerInnings["1"]}`);
  console.log(`rowsPerInnings[2]: ${stats.rowsPerInnings["2"]}`);
  console.log(`parserErrors: ${stats.parserErrors}`);

  console.log("ballsRemaining band counts (selected rows):");
  for (const band of BALLS_REMAINING_BANDS) {
    console.log(`  - ${band.key} (${band.label}): ${stats.rowsPerBand[band.key]}`);
  }

  console.log("ballsRemaining band counts (all candidates before sampling):");
  for (const band of BALLS_REMAINING_BANDS) {
    console.log(`  - ${band.key} (${band.label}): ${stats.candidatesPerBand[band.key]}`);
  }

  const topSkipReasons = Object.entries(stats.skipReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topSkipReasons.length > 0) {
    console.log("topSkipReasons:");
    for (const [reason, count] of topSkipReasons) {
      console.log(`  - ${reason}: ${count}`);
    }
  }

  const includesCombined =
    options.includeCompetitions.has("ipl") && options.includeCompetitions.has("t20i");

  if (includesCombined && stats.rowsWritten < 50000) {
    console.warn("\n⚠️  WARNING: rowsWritten < 50,000 for combined IPL+T20I export.");
    console.warn("   Check skip reasons above and verify raw data directories are correct.");
  }
}

async function main() {
  const options = parseOptions();
  console.log("=== Export Training Rows (v4/v4.1/v4.2/v4.3) ===");
  console.log(`featureVersion: ${options.featureVersion}`);
  console.log(`out: ${path.resolve(process.cwd(), options.out)}`);
  console.log(`seed: ${options.seed}`);
  console.log(`sampling: ${options.sampling}`);
  console.log(`sampleEveryBalls: ${options.sampleEveryBalls}`);
  console.log(`maxPerBandPerMatch: ${options.maxPerBandPerMatch}`);
  console.log(`alwaysIncludeLastBalls: ${options.alwaysIncludeLastBalls}`);
  console.log(`balancedByCompetition: ${options.balancedByCompetition}`);
  console.log(
    `includeCompetitions: ${Array.from(options.includeCompetitions.values()).join(",")}`
  );
  if (options.maxMatches) {
    console.log(`maxMatches: ${options.maxMatches}`);
  }

  const stats = await exportRows(options);
  printSummary(options, stats);
}

main().catch((err) => {
  console.error("export:v4 failed:", err);
  process.exit(1);
});
