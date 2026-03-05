import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { buildV3Features } from "@/lib/features/buildV3Features";

const prisma = new PrismaClient();

/**
 * Single training row (one legal ball)
 */
export interface TrainingRow {
  // Identifiers
  matchId: string;
  sourceMatchId: string | null;
  matchDate: string | null;
  innings: number;
  over: number;
  ballInOver: number;
  legalBallNumber: number;
  battingTeam: "A" | "B";
  
  // Player identifiers
  strikerExternalId: string | null;
  strikerName: string;
  nonStrikerExternalId: string | null;
  nonStrikerName: string;
  bowlerExternalId: string | null;
  bowlerName: string;
  
  // Core state
  runs: number; // Runs in current innings so far
  wickets: number; // Wickets in current innings so far
  balls: number; // Legal balls in current innings so far
  ballsRemaining: number; // 120 - balls
  rr: number; // Run rate (runs per 6 balls)
  
  // Innings 2 specific
  targetRuns?: number;
  runsNeeded?: number; // targetRuns - runs
  rrr?: number; // Required run rate
  
  // Rolling window stats (last 6 balls in this innings)
  runsLast6: number;
  wktsLast6: number;
  dotsLast6: number;
  boundariesLast6: number;
  
  // Rolling window stats (last 12 balls in this innings)
  runsLast12: number;
  wktsLast12: number;
  dotsLast12: number;
  boundariesLast12: number;
  
  // Ball outcome
  runsThisBallTotal: number; // Total runs (bat + extras) on this ball
  isWicketThisBall: boolean;
  isBoundaryThisBall: boolean; // True if 4 or 6 runs off bat (and no wide/no-ball)
  
  // Label
  y: number; // 1 if Team A won, 0 if Team B won
}

/**
 * Feature documentation for training rows
 */
const FEATURE_DOCUMENTATION = {
  identifiers: {
    matchId: "Unique match identifier in database",
    sourceMatchId: "External Cricsheet match ID",
    matchDate: "ISO timestamp of match start",
    innings: "Innings number (1 or 2)",
    over: "Over number (0-19 in T20)",
    ballInOver: "Ball number within over (0-5)",
    legalBallNumber: "Sequential legal ball count in innings",
    battingTeam: "Batting team (A or B)",
  },
  players: {
    strikerExternalId: "Striker external identifier (Cricsheet ID)",
    strikerName: "Striker player name",
    nonStrikerExternalId: "Non-striker external identifier",
    nonStrikerName: "Non-striker player name",
    bowlerExternalId: "Bowler external identifier",
    bowlerName: "Bowler player name",
  },
  coreState: {
    runs: "Total runs scored by batting team in current innings",
    wickets: "Total wickets lost by batting team in current innings",
    balls: "Total legal balls faced in current innings",
    ballsRemaining: "Legal balls remaining (always 120 - balls)",
    rr: "Run rate (runs per 6 balls) in current innings",
  },
  innings2: {
    targetRuns: "Runs needed to win (Innings 1 total + 1); only in Innings 2",
    runsNeeded: "Runs required to win from this point (targetRuns - runs)",
    rrr: "Required run rate (runs per 6 balls) to win from this point",
  },
  rollingWindow6: {
    runsLast6: "Total runs in last 6 legal balls (or fewer if not yet reached)",
    wktsLast6: "Total wickets in last 6 legal balls",
    dotsLast6: "Total dot balls (0 runs) in last 6 legal balls",
    boundariesLast6: "Total boundary balls (4 or 6 runs) in last 6 legal balls",
  },
  rollingWindow12: {
    runsLast12: "Total runs in last 12 legal balls (or fewer if not yet reached)",
    wktsLast12: "Total wickets in last 12 legal balls",
    dotsLast12: "Total dot balls (0 runs) in last 12 legal balls",
    boundariesLast12: "Total boundary balls (4 or 6 runs) in last 12 legal balls",
  },
  ballOutcome: {
    runsThisBallTotal: "Total runs scored on this ball (bat + extras: wides, no-balls, byes, leg-byes)",
    isWicketThisBall: "True if a wicket fell on this ball",
    isBoundaryThisBall: "True if this ball resulted in 4 or 6 runs off bat (excluding extras)",
  },
  labels: {
    y: "Target label: 1 if Team A won the match, 0 if Team B won",
  },
};

/**
 * Compute SHA256 hash of a file
 */
function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Write feature documentation
 */
function writeFeatureDocumentation(outputDir: string): string {
  const docPath = path.join(outputDir, "feature_documentation.json");
  fs.writeFileSync(
    docPath,
    JSON.stringify(FEATURE_DOCUMENTATION, null, 2),
    "utf-8"
  );
  return docPath;
}

/**
 * Build training rows from a single match
 */
async function buildRowsForMatch(matchId: string): Promise<TrainingRow[]> {
  // Fetch match
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      teamA: true,
      teamB: true,
      source: true,
      sourceMatchId: true,
      matchDate: true,
      winnerTeam: true,
    },
  });

  if (!match || !match.winnerTeam) {
    return []; // Skip incomplete matches
  }

  const label = match.winnerTeam === "A" ? 1 : 0;

  // Fetch ball events
  const ballEvents = await prisma.ballEvent.findMany({
    where: { matchId },
    orderBy: [{ innings: "asc" }, { over: "asc" }, { ballInOver: "asc" }],
    select: {
      id: true,
      innings: true,
      over: true,
      ballInOver: true,
      legalBallNumber: true,
      battingTeam: true,
      strikerId: true,
      nonStrikerId: true,
      bowlerId: true,
      runsBat: true,
      runsExtras: true,
      runsTotal: true,
      isWide: true,
      isNoBall: true,
      isWicket: true,
    },
  });

  // Fetch players (all unique player IDs)
  const playerIds = new Set<string>();
  ballEvents.forEach((e) => {
    playerIds.add(e.strikerId);
    playerIds.add(e.nonStrikerId);
    playerIds.add(e.bowlerId);
  });

  const players = await prisma.player.findMany({
    where: { id: { in: Array.from(playerIds) } },
    select: { id: true, name: true, externalId: true },
  });

  const playerMap = new Map(players.map((p) => [p.id, p]));

  // Process ball events and track state
  const rows: TrainingRow[] = [];
  const legalBallsByInnings: Record<number, any[]> = {};

  // First pass: collect legal balls by innings for rolling window calculation
  for (const event of ballEvents) {
    const isLegal = !event.isWide && !event.isNoBall;
    if (isLegal) {
      if (!(event.innings in legalBallsByInnings)) {
        legalBallsByInnings[event.innings] = [];
      }
      legalBallsByInnings[event.innings].push(event);
    }
  }

  // Second pass: build rows
  const runsByInnings: Record<number, number> = {};
  const wktsByInnings: Record<number, number> = {};
  const ballsByInnings: Record<number, number> = {};

  for (const event of ballEvents) {
    const inningsNum = event.innings;
    const isLegal = !event.isWide && !event.isNoBall;

    // Initialize innings if needed
    if (!(inningsNum in runsByInnings)) {
      runsByInnings[inningsNum] = 0;
      wktsByInnings[inningsNum] = 0;
      ballsByInnings[inningsNum] = 0;
    }

    // Update counters AFTER this ball
    runsByInnings[inningsNum] += event.runsTotal;
    if (event.isWicket) {
      wktsByInnings[inningsNum]++;
    }
    if (isLegal) {
      ballsByInnings[inningsNum]++;
    }

    // Only create row for legal balls
    if (!isLegal) {
      continue;
    }

    const currentRuns = runsByInnings[inningsNum];
    const currentWkts = wktsByInnings[inningsNum];
    const currentBalls = ballsByInnings[inningsNum];

    // Compute rolling window stats
    const legalBallsThisInnings = legalBallsByInnings[inningsNum];
    const currentBallIndex = legalBallsThisInnings.findIndex((b) => b.id === event.id);

    const last6 = legalBallsThisInnings.slice(
      Math.max(0, currentBallIndex - 5),
      currentBallIndex
    );
    const last12 = legalBallsThisInnings.slice(
      Math.max(0, currentBallIndex - 11),
      currentBallIndex
    );

    const runsLast6 = last6.reduce((sum, b) => sum + b.runsTotal, 0);
    const wktsLast6 = last6.filter((b) => b.isWicket).length;
    const dotsLast6 = last6.filter((b) => b.runsTotal === 0).length;
    const boundariesLast6 = last6.filter(
      (b) => b.runsTotal === 4 || b.runsTotal === 6
    ).length;

    const runsLast12 = last12.reduce((sum, b) => sum + b.runsTotal, 0);
    const wktsLast12 = last12.filter((b) => b.isWicket).length;
    const dotsLast12 = last12.filter((b) => b.runsTotal === 0).length;
    const boundariesLast12 = last12.filter(
      (b) => b.runsTotal === 4 || b.runsTotal === 6
    ).length;

    // Compute target for innings 2
    const targetRuns =
      inningsNum === 2 && runsByInnings[1] !== undefined
        ? runsByInnings[1] + 1
        : undefined;

    const featureRow = buildV3Features(
      { teamA: match.teamA, teamB: match.teamB },
      {
        innings: inningsNum as 1 | 2,
        battingTeam: event.battingTeam as "A" | "B",
        runs: currentRuns,
        wickets: currentWkts,
        balls: currentBalls,
        targetRuns,
        runsThisBall: event.runsTotal,
        isWicketThisBall: event.isWicket,
      },
      {
        runsLast6,
        wktsLast6,
        dotsLast6,
        boundariesLast6,
        runsLast12,
        wktsLast12,
        dotsLast12,
        boundariesLast12,
      }
    );

    // Get player details
    const striker = playerMap.get(event.strikerId);
    const nonStriker = playerMap.get(event.nonStrikerId);
    const bowler = playerMap.get(event.bowlerId);

    // Check if boundary (4 or 6 runs total, and it's a legal ball)
    const isBoundary = event.runsTotal === 4 || event.runsTotal === 6;

    const row: TrainingRow = {
      matchId: match.id,
      sourceMatchId: match.sourceMatchId,
      matchDate: match.matchDate?.toISOString() ?? null,
      innings: inningsNum,
      over: event.over,
      ballInOver: event.ballInOver,
      legalBallNumber: event.legalBallNumber || 0,
      battingTeam: event.battingTeam as "A" | "B",
      
      strikerExternalId: striker?.externalId ?? null,
      strikerName: striker?.name || "Unknown",
      nonStrikerExternalId: nonStriker?.externalId ?? null,
      nonStrikerName: nonStriker?.name || "Unknown",
      bowlerExternalId: bowler?.externalId ?? null,
      bowlerName: bowler?.name || "Unknown",
      
      runs: featureRow.runs,
      wickets: featureRow.wickets,
      balls: featureRow.balls,
      ballsRemaining: featureRow.ballsRemaining,
      rr: featureRow.rr,
      
      targetRuns: inningsNum === 2 ? featureRow.targetRuns : undefined,
      runsNeeded: inningsNum === 2 ? featureRow.runsNeeded : undefined,
      rrr: inningsNum === 2 ? featureRow.rrr : undefined,
      
      runsLast6: featureRow.runsLast6,
      wktsLast6: featureRow.wktsLast6,
      dotsLast6: featureRow.dotsLast6,
      boundariesLast6: featureRow.boundariesLast6,
      
      runsLast12: featureRow.runsLast12,
      wktsLast12: featureRow.wktsLast12,
      dotsLast12: featureRow.dotsLast12,
      boundariesLast12: featureRow.boundariesLast12,
      
      runsThisBallTotal: featureRow.runsThisBallTotal,
      isWicketThisBall: featureRow.isWicketThisBall === 1,
      isBoundaryThisBall: featureRow.isBoundaryThisBall === 1,
      
      y: label,
    };

    rows.push(row);
  }

  return rows;
}

/**
 * Main export function
 */
export async function exportTrainingData(): Promise<{
  totalMatches: number;
  completedMatches: number;
  totalRows: number;
  skippedMatches: number;
}> {
  console.log("🏏 Exporting training data from imported matches...\n");

  // Create output directory
  const outputDir = path.join(process.cwd(), "training");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, "training_rows.jsonl");
  const summaryPath = path.join(outputDir, "export_summary.json");
  const samplePath = path.join(outputDir, "validation_sample.json");
  const writeStream = fs.createWriteStream(outputPath);

  // Fetch all completed imported matches
  const matches = await prisma.match.findMany({
    where: {
      source: "cricsheet",
      winnerTeam: { not: null },
    },
    select: { id: true },
    orderBy: { matchDate: "desc" },
  });

  console.log(`Found ${matches.length} completed imported matches\n`);

  let totalRows = 0;
  let skipped = 0;
  const skippedMatches: string[] = [];
  const sampleRows: TrainingRow[] = [];

  // Process each match
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    try {
      const rows = await buildRowsForMatch(match.id);
      
      if (rows.length === 0) {
        skipped++;
        skippedMatches.push(match.id);
        continue;
      }

      // Write each row as JSONL
      for (const row of rows) {
        writeStream.write(JSON.stringify(row) + "\n");
        totalRows++;

        // Collect first 5 rows for validation sample
        if (sampleRows.length < 5) {
          sampleRows.push(row);
        }
      }

      console.log(
        `✓ Match ${i + 1}/${matches.length}: ${rows.length} rows exported`
      );
    } catch (error) {
      console.error(`✗ Error processing match ${match.id}:`, error);
      skipped++;
      skippedMatches.push(match.id);
    }
  }

  // Close write stream
  writeStream.end();

  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => {
      console.log("\n✓ Stream finished writing");
      resolve();
    });
    writeStream.on("error", (err) => {
      console.error("✗ Stream error:", err);
      reject(err);
    });
  });

  console.log(`\n📝 Writing validation sample (${sampleRows.length} rows)...`);
  // Write validation sample
  fs.writeFileSync(
    samplePath,
    JSON.stringify(sampleRows, null, 2),
    "utf-8"
  );
  console.log(`✓ Validation sample written to ${samplePath}`);

  console.log(`\n📖 Generating feature documentation...`);
  // Write feature documentation
  const docPath = writeFeatureDocumentation(outputDir);
  console.log(`✓ Feature documentation written to ${docPath}`);

  console.log(`\n🔐 Computing checksums...`);
  // Compute checksums (after all files are written)
  const rowsHash = computeFileHash(outputPath);
  console.log(`✓ trainingRows SHA256: ${rowsHash.substring(0, 16)}...`);
  
  const sampleHash = computeFileHash(samplePath);
  console.log(`✓ validationSample SHA256: ${sampleHash.substring(0, 16)}...`);
  
  const docHash = computeFileHash(docPath);
  console.log(`✓ featureDocumentation SHA256: ${docHash.substring(0, 16)}...`);

  // Write summary (must come before final checksum)
  const summary = {
    exportedAt: new Date().toISOString(),
    totalMatches: matches.length,
    completedMatches: matches.length - skipped,
    totalRows,
    skippedMatches: skipped,
    skippedMatchIds: skippedMatches,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\n✓ Summary written to ${summaryPath}`);

  // Update summary with file metadata - recompute sizes to get accurate bytes
  const finalSummary = {
    ...summary,
    files: {
      trainingRows: {
        path: outputPath,
        bytes: fs.statSync(outputPath).size, // Get actual file size after close
        sha256: rowsHash,
      },
      validationSample: {
        path: samplePath,
        bytes: fs.statSync(samplePath).size,
        sha256: sampleHash,
        rowCount: sampleRows.length,
      },
      featureDocumentation: {
        path: docPath,
        bytes: fs.statSync(docPath).size,
        sha256: docHash,
      },
      summary: {
        path: summaryPath,
        bytes: 0, // Will be updated after writing
      },
    },
  };

  // Write final summary
  fs.writeFileSync(summaryPath, JSON.stringify(finalSummary, null, 2), "utf-8");
  console.log(`✓ Final summary written with checksums`);

  // Update summary file size in memory (for reference)
  const finalSummarySize = fs.statSync(summaryPath).size;

  console.log(`\n📊 Export complete!`);
  console.log(`   Total matches: ${matches.length}`);
  console.log(`   Completed matches: ${matches.length - skipped}`);
  console.log(`   Total training rows: ${totalRows}`);
  console.log(`   Skipped matches: ${skipped}`);
  console.log(`\n📁 Output files:`);
  console.log(`   • trainingRows: ${finalSummary.files.trainingRows.bytes.toLocaleString()} bytes`);
  console.log(`   • validationSample: ${finalSummary.files.validationSample.rowCount} rows (${finalSummary.files.validationSample.bytes.toLocaleString()} bytes)`);
  console.log(`   • featureDocumentation: ${finalSummary.files.featureDocumentation.bytes.toLocaleString()} bytes`);
  console.log(`   • summary: ${finalSummarySize.toLocaleString()} bytes`);
  console.log(`\n✅ All checksums computed (SHA256)`);
  console.log();

  if (skippedMatches.length > 0 && skippedMatches.length <= 5) {
    console.log(`   ⚠️  Skipped match IDs: ${skippedMatches.join(", ")}`);
  }

  return {
    totalMatches: matches.length,
    completedMatches: matches.length - skipped,
    totalRows,
    skippedMatches: skipped,
  };
}

// Run if executed directly
if (require.main === module) {
  exportTrainingData()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
