import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function queryExample() {
  console.log("\n=== Example Queries on Imported Cricsheet Data ===\n");

  // 1. Get match with players
  const match = await prisma.match.findFirst({
    where: { source: "cricsheet" },
    include: {
      matchPlayers: {
        include: { player: true },
      },
    },
  });

  if (match) {
    console.log(`📋 Match: ${match.teamAName} vs ${match.teamBName}`);
    console.log(`   Venue: ${match.venue}`);
    console.log(`   Winner: Team ${match.winnerTeam}\n`);

    console.log(`Team A Players (${match.matchPlayers.filter(mp => mp.team === 'A').length}):`);
    match.matchPlayers
      .filter(mp => mp.team === 'A')
      .slice(0, 5)
      .forEach(mp => console.log(`  - ${mp.player.name}`));
    console.log();

    // 2. Get ball events for first over
    const firstOver = await prisma.ballEvent.findMany({
      where: {
        matchId: match.id,
        innings: 1,
        over: 0,
      },
      include: {
        striker: true,
        bowler: true,
      },
      orderBy: { legalBallNumber: 'asc' },
    });

    console.log(`\n🏏 First Over (Innings 1):`);
    firstOver.forEach((ball, idx) => {
      const extras = ball.isWide ? ' (Wide)' : ball.isNoBall ? ' (No-ball)' : '';
      const wicket = ball.isWicket ? ' WICKET!' : '';
      console.log(
        `  Ball ${idx + 1}: ${ball.striker.name} ${ball.runsBat}${extras}${wicket} - Bowler: ${ball.bowler.name}`
      );
    });

    // 3. Calculate innings summary
    const innings1Stats = await prisma.ballEvent.aggregate({
      where: {
        matchId: match.id,
        innings: 1,
      },
      _sum: {
        runsTotal: true,
      },
      _count: {
        id: true,
      },
    });

    const wickets = await prisma.ballEvent.count({
      where: {
        matchId: match.id,
        innings: 1,
        isWicket: true,
      },
    });

    console.log(`\n📊 Innings 1 Summary:`);
    console.log(`   Total Runs: ${innings1Stats._sum.runsTotal || 0}`);
    console.log(`   Wickets: ${wickets}`);
    console.log(`   Deliveries: ${innings1Stats._count.id}`);

    // 4. Top scoring batters (from ball events)
    const batterStats = await prisma.$queryRaw<
      Array<{ name: string; runs: bigint }>
    >`
      SELECT p.name, SUM(be."runsBat")::bigint as runs
      FROM ball_events be
      JOIN players p ON p.id = be."strikerId"
      WHERE be."matchId" = ${match.id}
      GROUP BY p.name
      ORDER BY runs DESC
      LIMIT 5
    `;

    console.log(`\n🏆 Top Scorers:`);
    batterStats.forEach((b, idx) => {
      console.log(`  ${idx + 1}. ${b.name}: ${b.runs} runs`);
    });
  }

  await prisma.$disconnect();
}

queryExample().catch(console.error);
