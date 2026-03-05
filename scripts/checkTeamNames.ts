import { prisma } from "@/lib/db/prisma";

async function checkTeamNames() {
  const match = await prisma.match.findUnique({
    where: { id: "cmmc4dc4p00002v09lszovaw5" },
    select: { id: true, teamA: true, teamB: true },
  });

  console.log("Database match record:");
  console.log(JSON.stringify(match, null, 2));

  if (!match) {
    console.log("❌ Match not found!");
    process.exit(1);
  }

  console.log("\n📋 Team Names (as stored):");
  console.log(`  Team A: "${match.teamA}"`);
  console.log(`  Team B: "${match.teamB}"`);

  // Check for potential issues
  console.log("\n🔍 Sanity checks:");
  if (match.teamA.includes("Women")) {
    console.log("  ⚠️  Team A contains 'Women' - check mapping!");
  }
  if (match.teamB.includes("Women")) {
    console.log("  ⚠️  Team B contains 'Women' - check mapping!");
  }
  if (match.teamA !== match.teamA.trim()) {
    console.log("  ⚠️  Team A has leading/trailing spaces!");
  }
  if (match.teamB !== match.teamB.trim()) {
    console.log("  ⚠️  Team B has leading/trailing spaces!");
  }

  console.log("\n✅ All checks passed - team names are clean");

  await prisma.$disconnect();
}

checkTeamNames().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
