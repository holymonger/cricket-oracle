import { runBacktestEdgeV1 } from "@/lib/paper/backtestEdgeV1";

async function main() {
  const threshold = process.env.BACKTEST_THRESHOLD
    ? Number(process.env.BACKTEST_THRESHOLD)
    : 0.03;
  const stake = process.env.BACKTEST_STAKE
    ? Number(process.env.BACKTEST_STAKE)
    : 10;
  const limitMatches = process.env.BACKTEST_LIMIT
    ? Number(process.env.BACKTEST_LIMIT)
    : 100;
  const includeTeamB = process.env.BACKTEST_INCLUDE_TEAM_B === "1";

  const { summary, bets } = await runBacktestEdgeV1({
    threshold,
    stake,
    limitMatches,
    includeTeamB,
  });

  console.log("\n🏏 Backtest: edge-v1");
  console.log(`Matches processed: ${summary.matchesProcessed}`);
  console.log(`Bets: ${summary.bets}`);
  console.log(`Wins/Losses/Pushes: ${summary.wins}/${summary.losses}/${summary.pushes}`);
  console.log(`Win rate: ${(summary.winRate * 100).toFixed(2)}%`);
  console.log(`Total staked: ${summary.totalStaked.toFixed(2)}`);
  console.log(`Total PnL: ${summary.totalPnl.toFixed(2)}`);
  console.log(`ROI: ${(summary.roi * 100).toFixed(2)}%`);
  console.log(`Average odds: ${summary.averageOdds.toFixed(3)}`);
  console.log(
    `PnL dist (p10/p50/p90): ${summary.pnlDistribution.p10.toFixed(2)} / ${summary.pnlDistribution.p50.toFixed(2)} / ${summary.pnlDistribution.p90.toFixed(2)}`
  );

  if (bets.length > 0) {
    console.log("\nRecent bets:");
    for (const bet of bets.slice(-10)) {
      console.log(
        `${bet.matchId} | side=${bet.side} | odds=${bet.oddsDecimal.toFixed(2)} | result=${bet.result} | pnl=${bet.pnl.toFixed(2)}`
      );
    }
  }

  console.log(
    "\nPnL convention: net profit/loss excluding returned stake (win=stake*(odds-1), loss=-stake)."
  );
}

main().catch((error) => {
  console.error("Backtest failed:", error);
  process.exit(1);
});
