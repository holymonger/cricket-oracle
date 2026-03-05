import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verifyImport() {
  console.log("\n=== Cricsheet Import Verification ===\n");

  const matches = await prisma.match.findMany({
    where: { source: "cricsheet" },
    orderBy: { matchDate: "asc" },
  });

  console.log(`Total matches imported: ${matches.length}\n`);

  for (const match of matches) {
    const ballCount = await prisma.ballEvent.count({
      where: { matchId: match.id },
    });
    const playerCount = await prisma.matchPlayer.count({
      where: { matchId: match.id },
    });

    console.log(`📊 Match: ${match.teamAName} vs ${match.teamBName}`);
    console.log(`   ID: ${match.sourceMatchId}`);
    console.log(`   Date: ${match.matchDate?.toISOString().split('T')[0] || 'N/A'}`);
    console.log(`   Venue: ${match.venue || 'N/A'}`);
    console.log(`   Winner: Team ${match.winnerTeam || 'N/A'}`);
    console.log(`   Ball Events: ${ballCount}`);
    console.log(`   Players: ${playerCount}`);
    console.log();
  }

  // Check total players
  const totalPlayers = await prisma.player.count();
  console.log(`Total unique players: ${totalPlayers}`);

  // Check ball events
  const totalBalls = await prisma.ballEvent.count();
  console.log(`Total ball events: ${totalBalls}`);

  await prisma.$disconnect();
}

verifyImport().catch(console.error);
