import { prisma } from "@/lib/db/prisma";

const ADMIN_KEY = process.env.ADMIN_KEY || "Mountain111";
const API_BASE = "http://localhost:3000";
const TEST_MATCH_ID = "cmmc4dc4p00002v09lszovaw5";

async function testTickEndpoint() {
  console.log("🏏 Testing POST /api/realtime/tick endpoint\n");

  for (let i = 0; i < 3; i++) {
    console.log(`\n▶️  Tick ${i + 1}`);
    console.log("━".repeat(50));

    try {
      const res = await fetch(`${API_BASE}/api/realtime/tick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": ADMIN_KEY,
        },
        body: JSON.stringify({
          matchId: TEST_MATCH_ID,
          provider: "cricsheet-replay",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error(`✗ Error ${res.status}:`, err);
        continue;
      }

      const data = await res.json();

      if (data.prediction) {
        console.log(`✓ Prediction:`);
        console.log(`  - Ball: ${data.prediction.legalBallNumber}`);
        console.log(`  - Team A Win Prob: ${(data.prediction.teamAWinProb * 100).toFixed(2)}%`);
        console.log(`  - Time: ${new Date(data.prediction.createdAt).toLocaleTimeString()}`);
      }

      if (data.edge) {
        console.log(`\n✓ Edge Signal:`);
        console.log(`  - Market: ${data.edge.marketName}`);
        console.log(`  - Fair Prob A: ${(data.edge.marketProbA_fair * 100).toFixed(2)}%`);
        console.log(`  - Edge A: +${(data.edge.edgeA * 100).toFixed(2)}%`);
        console.log(`  - Overround: ${((data.edge.overround - 1) * 100).toFixed(2)}%`);
      }

      if (data.staleness) {
        const icon = data.staleness.stale ? "⚠️" : "✓";
        console.log(`\n${icon} Staleness:`);
        console.log(`  - Time Diff: ${data.staleness.secondsDiff}s`);
        console.log(`  - Stale: ${data.staleness.stale ? "YES" : "NO"}`);
        if (data.staleness.warning) {
          console.log(`  - Warning: ${data.staleness.warning}`);
        }
      }
    } catch (error) {
      console.error(`✗ Exception:`, (error as Error).message);
    }

    if (i < 2) {
      console.log("\n⏳ Waiting 2 seconds...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("\n\n✅ Tick endpoint testing complete!");
}

testTickEndpoint()
  .catch(console.error)
  .finally(() => process.exit(0));
