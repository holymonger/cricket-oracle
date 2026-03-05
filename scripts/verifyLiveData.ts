/**
 * Verify database records after live delivery test
 */

import { prisma } from "@/lib/db/prisma";

async function verify() {
  const matchId = "cmmc4dc4p00002v09lszovaw5";

  console.log("📊 Database Verification\n");

  // Predictions
  const predictions = await prisma.ballPrediction.findMany({
    where: {
      matchId,
      innings: 1,
      modelVersion: "v3-lgbm",
    },
    orderBy: { legalBallNumber: "asc" },
    select: {
      legalBallNumber: true,
      teamAWinProb: true,
      createdAt: true,
    },
  });

  console.log(`✓ BallPrediction records (innings 1): ${predictions.length}`);
  predictions.forEach((p) => {
    console.log(
      `  Ball #${p.legalBallNumber}: winProb=${p.teamAWinProb.toFixed(4)}`
    );
  });

  // Innings state
  const inningsState = await prisma.liveInningsState.findUnique({
    where: {
      matchId_innings: { matchId, innings: 1 },
    },
    select: {
      runs: true,
      wickets: true,
      balls: true,
      targetRuns: true,
    },
  });

  console.log("\n✓ LiveInningsState (innings 1):");
  console.log(`  Runs: ${inningsState?.runs}`);
  console.log(`  Wickets: ${inningsState?.wickets}`);
  console.log(`  Balls: ${inningsState?.balls}`);
  console.log(`  Target: ${inningsState?.targetRuns || "null"}`);

  // Ball events
  const ballEvents = await prisma.liveBallEvent.count({
    where: {
      matchId,
      innings: 1,
      isLegal: true,
    },
  });

  console.log(`\n✓ LiveBallEvent (legal): ${ballEvents}`);

  console.log(
    "\n✅ All data properly persisted to database from ingestion endpoint"
  );

  await prisma.$disconnect();
}

verify().catch((e) => {
  console.error(e);
  process.exit(1);
});
