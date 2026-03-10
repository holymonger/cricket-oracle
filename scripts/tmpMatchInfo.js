const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const match = await prisma.match.findFirst({
    where: { ballEvents: { some: { legalBallNumber: { not: null } } } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      teamA: true,
      teamB: true,
      winnerTeam: true,
      _count: {
        select: {
          ballEvents: true,
          ballPredictions: true,
          edgeSignals: true,
        },
      },
    },
  });

  console.log(JSON.stringify(match, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
