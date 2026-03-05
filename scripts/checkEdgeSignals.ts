import { prisma } from "@/lib/db/prisma";

async function checkEdgeSignals() {
  console.log("📊 Checking Edge Signals in Database\n");

  const signals = await prisma.edgeSignal.findMany({
    take: 10,
    orderBy: { observedAt: "desc" },
    include: {
      match: {
        select: {
          teamA: true,
          teamB: true,
        },
      },
      marketEvent: {
        include: {
          market: true,
          oddsTicks: {
            orderBy: { side: "asc" },
          },
        },
      },
    },
  });

  if (signals.length === 0) {
    console.log("No edge signals found in database.");
    return;
  }

  console.log(`Found ${signals.length} edge signals:\n`);

  for (const signal of signals) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(
      `Match: ${signal.match.teamA} vs ${signal.match.teamB}`
    );
    console.log(`Market: ${signal.marketEvent.market.name}`);
    console.log(`Observed: ${signal.observedAt.toLocaleString()}`);
    console.log(`Model Version: ${signal.modelVersion}`);
    console.log();

    const oddsA = signal.marketEvent.oddsTicks.find((t) => t.side === "A");
    const oddsB = signal.marketEvent.oddsTicks.find((t) => t.side === "B");

    if (oddsA && oddsB) {
      console.log(`Odds: ${oddsA.teamName} ${oddsA.oddsDecimal} | ${oddsB.teamName} ${oddsB.oddsDecimal}`);
    }

    console.log(`Model Prob A: ${(signal.teamAWinProb * 100).toFixed(2)}%`);
    console.log(
      `Market Prob A (raw): ${(signal.marketProbA_raw * 100).toFixed(2)}%`
    );
    console.log(
      `Market Prob A (fair): ${(signal.marketProbA_fair * 100).toFixed(2)}%`
    );
    console.log(
      `Overround: ${((signal.overround - 1) * 100).toFixed(2)}%`
    );
    console.log(`Edge A: ${(signal.edgeA * 100).toFixed(2)}%`);

    if (Math.abs(signal.edgeA) > 0.05) {
      console.log(`🎯 SIGNIFICANT EDGE!`);
    }

    if (signal.notes) {
      console.log(`Notes: ${signal.notes}`);
    }
    console.log();
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Summary stats
  const avgEdge =
    signals.reduce((sum, s) => sum + Math.abs(s.edgeA), 0) / signals.length;
  const maxEdge = Math.max(...signals.map((s) => Math.abs(s.edgeA)));
  const significantCount = signals.filter((s) => Math.abs(s.edgeA) > 0.05)
    .length;

  console.log("\n📈 Summary:");
  console.log(`  Average Edge: ${(avgEdge * 100).toFixed(2)}%`);
  console.log(`  Max Edge: ${(maxEdge * 100).toFixed(2)}%`);
  console.log(
    `  Significant (>5%): ${significantCount}/${signals.length}`
  );

  // Check odds ticks
  const totalTicks = await prisma.oddsTick.count();
  console.log(`\n📍 Total Odds Ticks: ${totalTicks}`);
}

checkEdgeSignals()
  .catch(console.error)
  .finally(() => process.exit(0));
