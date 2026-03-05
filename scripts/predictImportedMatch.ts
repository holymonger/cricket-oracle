import { PrismaClient } from "@prisma/client";
import { computeWinProb } from "@/lib/model";
import type { MatchState } from "@/lib/model/types";
import { buildV3Features } from "@/lib/features/buildV3Features";

const prisma = new PrismaClient();

/**
 * Predict and store Team A win% for each legal ball in a single imported match
 */
async function predictImportedMatch(
  matchId: string | undefined,
  sourceMatchId: string | undefined,
  modelVersion: string = "v3-lgbm"
): Promise<{ inserted: number; updated: number }> {
  // Determine which match to load
  let match;

  if (matchId) {
    match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        teamA: true,
        teamB: true,
        source: true,
        sourceMatchId: true,
        winnerTeam: true,
      },
    });
  } else if (sourceMatchId) {
    match = await prisma.match.findFirst({
      where: { sourceMatchId },
      select: {
        id: true,
        teamA: true,
        teamB: true,
        source: true,
        sourceMatchId: true,
        winnerTeam: true,
      },
    });
  }

  if (!match) {
    throw new Error(
      `Match not found (matchId: ${matchId}, sourceMatchId: ${sourceMatchId})`
    );
  }

  if (!match.winnerTeam) {
    throw new Error(
      `Cannot predict on incomplete match ${match.id} (no winner recorded)`
    );
  }

  console.log(`📊 Predicting ${modelVersion} for match ${match.sourceMatchId}`);

  // Fetch all ball events grouped by innings
  const ballEvents = await prisma.ballEvent.findMany({
    where: { matchId: match.id },
    orderBy: [{ innings: "asc" }, { over: "asc" }, { ballInOver: "asc" }],
    include: {
      striker: { select: { externalId: true, name: true } },
      nonStriker: { select: { externalId: true, name: true } },
      bowler: { select: { externalId: true, name: true } },
    },
  });

  if (ballEvents.length === 0) {
    console.warn(`  ⚠️  No ball events found for match ${match.id}`);
    return { inserted: 0, updated: 0 };
  }

  // Build state progressively per legal ball
  const stateByInnings: Record<number, { runs: number; wickets: number; balls: number }> = {};
  const legalHistoryByInnings: Record<number, Array<{ runsTotal: number; isWicket: boolean }>> = {};

  const firstInningsTarget =
    ballEvents
      .filter((event) => event.innings === 1 && event.legalBallNumber)
      .reduce((sum, event) => sum + event.runsTotal, 0) + 1;

  const predictions: Array<{
    matchId: string;
    innings: number;
    legalBallNumber: number;
    modelVersion: string;
    teamAWinProb: number;
    featuresJson?: string;
  }> = [];

  let inserted = 0;
  let updated = 0;

  for (const event of ballEvents) {
    // Skip illegal deliveries
    if (!event.legalBallNumber) {
      continue;
    }

    const inningsKey = event.innings;

    // Initialize innings state if needed
    if (!stateByInnings[inningsKey]) {
      stateByInnings[inningsKey] = {
        runs: 0,
        wickets: 0,
        balls: 0,
      };
    }

    if (!legalHistoryByInnings[inningsKey]) {
      legalHistoryByInnings[inningsKey] = [];
    }

    const state = stateByInnings[inningsKey];
    const history = legalHistoryByInnings[inningsKey];

    // Update state to represent post-delivery context
    state.runs += event.runsTotal;
    state.balls += 1;
    if (event.isWicket) {
      state.wickets += 1;
    }

    const last6 = history.slice(Math.max(0, history.length - 6));
    const last12 = history.slice(Math.max(0, history.length - 12));

    const rolling = {
      runsLast6: last6.reduce((sum, b) => sum + b.runsTotal, 0),
      wktsLast6: last6.filter((b) => b.isWicket).length,
      dotsLast6: last6.filter((b) => b.runsTotal === 0).length,
      boundariesLast6: last6.filter((b) => b.runsTotal === 4 || b.runsTotal === 6).length,
      runsLast12: last12.reduce((sum, b) => sum + b.runsTotal, 0),
      wktsLast12: last12.filter((b) => b.isWicket).length,
      dotsLast12: last12.filter((b) => b.runsTotal === 0).length,
      boundariesLast12: last12.filter((b) => b.runsTotal === 4 || b.runsTotal === 6).length,
    };

    const targetRuns = event.innings === 2 ? firstInningsTarget : undefined;

    const features = buildV3Features(
      { teamA: match.teamA, teamB: match.teamB },
      {
        innings: event.innings as 1 | 2,
        battingTeam: event.battingTeam as "A" | "B",
        runs: state.runs,
        wickets: state.wickets,
        balls: state.balls,
        targetRuns,
        runsThisBall: event.runsTotal,
        isWicketThisBall: event.isWicket,
      },
      rolling
    );

    const matchState: MatchState = {
      innings: event.innings as 1 | 2,
      battingTeam: event.battingTeam as "A" | "B",
      runs: state.runs,
      wickets: state.wickets,
      balls: state.balls,
      targetRuns: targetRuns ?? null,
    };

    // Compute win probability
    const result = computeWinProb(matchState, modelVersion as any, features);

    predictions.push({
      matchId: match.id,
      innings: event.innings,
      legalBallNumber: event.legalBallNumber,
      modelVersion,
      teamAWinProb: result.winProb,
      featuresJson: JSON.stringify(features),
    });

    history.push({
      runsTotal: event.runsTotal,
      isWicket: event.isWicket,
    });
  }

  // Upsert predictions into database
  for (const pred of predictions) {
    const existing = await prisma.ballPrediction.findUnique({
      where: {
        matchId_innings_legalBallNumber_modelVersion: {
          matchId: pred.matchId,
          innings: pred.innings,
          legalBallNumber: pred.legalBallNumber,
          modelVersion: pred.modelVersion,
        },
      },
    });

    if (existing) {
      await prisma.ballPrediction.update({
        where: { id: existing.id },
        data: {
          teamAWinProb: pred.teamAWinProb,
          featuresJson: pred.featuresJson,
        },
      });
      updated++;
    } else {
      await prisma.ballPrediction.create({
        data: pred,
      });
      inserted++;
    }
  }

  console.log(
    `  ✓ Predictions: ${inserted} inserted, ${updated} updated, total ${predictions.length}`
  );

  return { inserted, updated };
}

// Parse CLI arguments
async function main() {
  const args = process.argv.slice(2);
  let matchId: string | undefined;
  let sourceMatchId: string | undefined;
  let modelVersion = "v3-lgbm";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--matchId" && args[i + 1]) {
      matchId = args[i + 1];
      i++;
    } else if (args[i] === "--sourceMatchId" && args[i + 1]) {
      sourceMatchId = args[i + 1];
      i++;
    } else if (args[i] === "--modelVersion" && args[i + 1]) {
      modelVersion = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      // First positional arg is matchId
      if (!matchId && !sourceMatchId) {
        matchId = args[i];
      }
    }
  }

  if (!matchId && !sourceMatchId) {
    console.error(
      "Usage: tsx predictImportedMatch.ts <matchId|sourceMatchId> [--modelVersion v3-lgbm]"
    );
    process.exit(1);
  }

  try {
    const result = await predictImportedMatch(matchId, sourceMatchId, modelVersion);
    console.log(
      `\n✅ Prediction complete: ${result.inserted} created, ${result.updated} updated`
    );
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
