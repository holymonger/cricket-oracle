import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sourceMatchId = process.argv[2] || "1082591";
  
  // Get match ID
  const match = await prisma.match.findFirst({
    where: { sourceMatchId },
    select: { id: true, teamA: true, teamB: true, sourceMatchId: true, winnerTeam: true },
  });

  if (!match) {
    console.error(`Match ${sourceMatchId} not found`);
    process.exit(1);
  }

  console.log(`\n📊 Comparing predictions for Match ${match.sourceMatchId}`);
  console.log(`   ${match.teamA} vs ${match.teamB}`);
  console.log(`   Winner: Team ${match.winnerTeam}\n`);

  // Get predictions from both models
  const v3Predictions = await prisma.ballPrediction.findMany({
    where: {
      matchId: match.id,
      modelVersion: "v3-lgbm",
    },
    select: {
      innings: true,
      legalBallNumber: true,
      teamAWinProb: true,
      createdAt: true,
    },
    orderBy: [{ innings: "asc" }, { legalBallNumber: "asc" }],
  });

  const v4Predictions = await prisma.ballPrediction.findMany({
    where: {
      matchId: match.id,
      modelVersion: "v4-logreg",
    },
    select: {
      innings: true,
      legalBallNumber: true,
      teamAWinProb: true,
      createdAt: true,
    },
    orderBy: [{ innings: "asc" }, { legalBallNumber: "asc" }],
  });

  console.log(`v3-lgbm predictions: ${v3Predictions.length}`);
  console.log(`v4-logreg predictions: ${v4Predictions.length}\n`);

  // Create a map for v4 predictions using innings + legalBallNumber as key
  const v4Map = new Map(
    v4Predictions.map((p) => [`${p.innings}-${p.legalBallNumber}`, p.teamAWinProb])
  );

  // Sample every 20th ball for comparison
  const samples = v3Predictions.filter((_, i) => i % 20 === 0 || i === v3Predictions.length - 1);

  console.log("Ball-by-ball comparison (sample):\n");
  console.log("Inns.Ball".padEnd(12), "v3-lgbm".padEnd(10), "v4-logreg".padEnd(10), "Diff");
  console.log("-".repeat(55));

  for (const v3Pred of samples) {
    const v4Prob = v4Map.get(`${v3Pred.innings}-${v3Pred.legalBallNumber}`);
    if (v4Prob !== undefined) {
      const ballLabel = `${v3Pred.innings}.${v3Pred.legalBallNumber}`;
      const diff = Math.abs(v3Pred.teamAWinProb - v4Prob);
      const diffStr = diff > 0.05 ? `${diff.toFixed(4)} **` : diff.toFixed(4);
      console.log(
        `${ballLabel.padEnd(12)} ${v3Pred.teamAWinProb.toFixed(4).padEnd(10)} ${v4Prob.toFixed(4).padEnd(10)} ${diffStr}`
      );
    }
  }

  // Calculate statistics
  const diffs: number[] = [];
  const v3Probs: number[] = [];
  const v4Probs: number[] = [];

  for (const v3Pred of v3Predictions) {
    const v4Prob = v4Map.get(`${v3Pred.innings}-${v3Pred.legalBallNumber}`);
    if (v4Prob !== undefined) {
      diffs.push(Math.abs(v3Pred.teamAWinProb - v4Prob));
      v3Probs.push(v3Pred.teamAWinProb);
      v4Probs.push(v4Prob);
    }
  }

  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const maxDiff = Math.max(...diffs);
  const meanV3 = v3Probs.reduce((a, b) => a + b, 0) / v3Probs.length;
  const meanV4 = v4Probs.reduce((a, b) => a + b, 0) / v4Probs.length;

  console.log("\n" + "-".repeat(50));
  console.log("\nSummary Statistics:");
  console.log(`  Mean absolute difference: ${meanDiff.toFixed(4)}`);
  console.log(`  Max difference: ${maxDiff.toFixed(4)}`);
  console.log(`  Mean Team A win prob (v3-lgbm): ${meanV3.toFixed(4)}`);
  console.log(`  Mean Team A win prob (v4-logreg): ${meanV4.toFixed(4)}`);
  console.log(`  Compared ${diffs.length} balls\n`);
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
