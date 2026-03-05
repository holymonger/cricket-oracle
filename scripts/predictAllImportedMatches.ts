import { PrismaClient } from "@prisma/client";
import { computeWinProb } from "@/lib/model";
import type { MatchState } from "@/lib/model/types";

const prisma = new PrismaClient();

/**
 * Predict and store Team A win% for each legal ball in all imported matches
 */
async function predictAllImportedMatches(
  modelVersion: string = "v3-lgbm"
): Promise<{ totalMatches: number; totalInserted: number; totalUpdated: number; skipped: number }> {
  console.log(`🏏 Predicting ${modelVersion} for all imported matches...\n`);

  // Fetch all completed imported matches
  const matches = await prisma.match.findMany({
    where: {
      source: "cricsheet",
      winnerTeam: { not: null },
    },
    select: {
      id: true,
      teamA: true,
      teamB: true,
      sourceMatchId: true,
      winnerTeam: true,
    },
    orderBy: { sourceMatchId: "asc" },
  });

  console.log(`Found ${matches.length} completed imported matches\n`);

  let totalInserted = 0;
  let totalUpdated = 0;
  let skipped = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    try {
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
        console.log(`  ⊘ Match ${i + 1}/${matches.length} (${match.sourceMatchId}): No ball events`);
        skipped++;
        continue;
      }

      // Build state progressively per legal ball
      const stateByInnings: Record<number, any> = {};
      const predictions: Array<{
        matchId: string;
        innings: number;
        legalBallNumber: number;
        modelVersion: string;
        teamAWinProb: number;
        featuresJson?: string;
      }> = [];

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
            battingTeam: event.battingTeam as "A" | "B",
            innings: event.innings,
            targetRuns: undefined,
          };
        }

        const state = stateByInnings[inningsKey];

        // If first innings complete, compute target for second innings
        if (event.innings === 2 && !state.targetRuns && stateByInnings[1]) {
          const ing1Final = stateByInnings[1];
          state.targetRuns = ing1Final.runs + 1;
        }

        // Build features object
        const features: Record<string, number> = {
          runs: state.runs,
          wickets: state.wickets,
          balls: state.balls,
          ballsRemaining: 120 - state.balls,
          rr: state.balls > 0 ? (state.runs * 6) / state.balls : 0,
        };

        if (state.targetRuns) {
          features.targetRuns = state.targetRuns;
          features.runsNeeded = state.targetRuns - state.runs;
          const ballsRemaining = 120 - state.balls;
          features.rrr =
            ballsRemaining > 0
              ? (features.runsNeeded * 6) / ballsRemaining
              : 0;
        }

        // Placeholder rolling windows
        features.runsLast6 = 0;
        features.wktsLast6 = 0;
        features.dotsLast6 = 0;
        features.boundariesLast6 = 0;
        features.runsLast12 = 0;
        features.wktsLast12 = 0;
        features.dotsLast12 = 0;
        features.boundariesLast12 = 0;

        // Compute win probability
        const result = computeWinProb(state, modelVersion as any, features);

        predictions.push({
          matchId: match.id,
          innings: event.innings,
          legalBallNumber: event.legalBallNumber,
          modelVersion,
          teamAWinProb: result.winProb,
          featuresJson: JSON.stringify(features),
        });

        // Update state for next ball
        state.runs += event.runsTotal;
        state.balls += 1;
        if (event.isWicket) {
          state.wickets += 1;
        }
      }

      // Upsert predictions
      let matchInserted = 0;
      let matchUpdated = 0;

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
          matchUpdated++;
        } else {
          await prisma.ballPrediction.create({
            data: pred,
          });
          matchInserted++;
        }
      }

      totalInserted += matchInserted;
      totalUpdated += matchUpdated;

      console.log(
        `  ✓ Match ${i + 1}/${matches.length} (${match.sourceMatchId}): ${predictions.length} predictions (${matchInserted} new, ${matchUpdated} updated)`
      );
    } catch (error) {
      console.error(
        `  ✗ Error processing match ${match.sourceMatchId}:`,
        error instanceof Error ? error.message : String(error)
      );
      skipped++;
    }
  }

  return { totalMatches: matches.length, totalInserted, totalUpdated, skipped };
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  let modelVersion = "v3-lgbm";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--modelVersion" && args[i + 1]) {
      modelVersion = args[i + 1];
      i++;
    }
  }

  try {
    const result = await predictAllImportedMatches(modelVersion);
    console.log(`\n📊 Batch prediction complete!`);
    console.log(`   Total matches: ${result.totalMatches}`);
    console.log(`   Total predictions: ${result.totalInserted + result.totalUpdated}`);
    console.log(`   Inserted: ${result.totalInserted}`);
    console.log(`   Updated: ${result.totalUpdated}`);
    console.log(`   Skipped: ${result.skipped}`);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
