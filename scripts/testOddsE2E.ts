import { prisma } from "@/lib/db/prisma";

const ADMIN_KEY = process.env.ADMIN_KEY || "Mountain111";
const API_BASE = "http://localhost:3000";
const TEST_MATCH_ID = "cmmc4dc4p00002v09lszovaw5";

async function testE2E() {
  console.log("🏏 E2E Test: Live Delivery → Odds Comparison\n");

  // Step 1: Send live delivery
  console.log("📤 Step 1: Sending live delivery...");
  const deliveryPayload = {
    matchId: TEST_MATCH_ID,
    innings: 1,
    over: 1,
    ballInOver: 1,
    battingTeamName: "Mumbai Indians",
    strikerName: "Rohit Sharma",
    nonStrikerName: "Virat Kohli",
    bowlerName: "Anrich Nortje",
    runs: {
      total: 2,
      bat: 2,
      extras: 0,
    },
    provider: "realtime",
    providerEventId: `evt-live-${Date.now()}`,
    occurredAt: new Date().toISOString(),
  };

  try {
    const res1 = await fetch(`${API_BASE}/api/realtime/delivery`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(deliveryPayload),
    });

    if (!res1.ok) {
      const err = await res1.json();
      throw new Error(`Delivery failed: ${res1.status} - ${JSON.stringify(err)}`);
    }

    const data1 = await res1.json();
    console.log(`✓ Delivery created`);
    console.log(`  - Ball: ${data1.legalBallNumber ?? "N/A"}`);
    console.log(
      `  - Win Prob: ${data1.teamAWinProb ? data1.teamAWinProb.toFixed(4) : "N/A"}`
    );
    console.log();

    // Step 2: POST odds for same match
    console.log("📊 Step 2: POSTing odds snapshot to /api/markets/poll...");
    const oddsPayload = {
      matchId: TEST_MATCH_ID,
      timestamp: new Date().toISOString(),
      markets: [
        {
          marketName: "Match Winner",
          externalEventId: "evt-001",
          observedAt: new Date().toISOString(),
          selections: [
            { teamName: "Mumbai Indians", oddsDecimal: 1.85 },
            { teamName: "Delhi Capitals", oddsDecimal: 2.05 },
          ],
        },
      ],
    };

    const res2 = await fetch(`${API_BASE}/api/markets/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(oddsPayload),
    });

    if (!res2.ok) {
      const err = await res2.json();
      throw new Error(`Odds failed: ${res2.status} - ${JSON.stringify(err)}`);
    }

    const data2 = await res2.json();
    console.log(`✓ Markets poll result`);
    console.log(`  - Model Prob A: ${data2.model.teamAWinProb.toFixed(4)}`);
    console.log(`  - Markets processed: ${data2.results.length}`);

    if (data2.results[0]?.edgeSignal) {
      const edge = data2.results[0].edgeSignal;
      console.log(`  - Fair Prob A: ${edge.marketProbA_fair.toFixed(4)}`);
      console.log(`  - Edge A: ${edge.edgeA.toFixed(4)}`);
      console.log(
        `  - Significant: ${Math.abs(edge.edgeA) > 0.05 ? "YES 🎯" : "No"}`
      );
      console.log(`  - Ticks persisted: ${data2.results[0].ticksUpserted}`);
    }
    console.log();

    console.log("✅ E2E test complete! Data persisted to database.");
  } catch (error) {
    console.error("❌", (error as Error).message);
    process.exit(1);
  }
}

testE2E().finally(() => process.exit(0));
