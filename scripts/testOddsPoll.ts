import { prisma } from "@/lib/db/prisma";

const ADMIN_KEY = process.env.ADMIN_KEY || "test-admin-key";
const API_BASE = "http://localhost:3000";
const TEST_MATCH_ID = "cmmc4dc4p00002v09lszovaw5";

async function testOddsPoll() {
  console.log("🏏 Testing POST /api/odds/poll endpoint\n");

  // Get latest prediction for target match
  const latestPred = await prisma.ballPrediction.findFirst({
    where: { matchId: TEST_MATCH_ID, modelVersion: "v3-lgbm" },
    orderBy: [
      { innings: "desc" },
      { legalBallNumber: "desc" },
      { createdAt: "desc" },
    ],
  });

  if (!latestPred) {
    console.error(
      "❌ No v3-lgbm prediction found for match. Run testLiveDelivery first."
    );
    process.exit(1);
  }

  console.log(`📊 Latest Prediction:`);
  console.log(`  - Innings: ${latestPred.innings}`);
  console.log(`  - Ball: ${latestPred.legalBallNumber}`);
  console.log(`  - Team A Win Prob: ${latestPred.teamAWinProb.toFixed(4)}`);
  console.log();

  // Test 1: Valid two-sided odds (Mumbai -120 / Delhi +100)
  console.log("Test 1️⃣  Valid two-sided odds with edge");
  const req1 = {
    matchId: TEST_MATCH_ID,
    timestamp: new Date().toISOString(),
    markets: [
      {
        marketName: "Match Winner",
        externalEventId: "ext-mw-001",
        observedAt: new Date().toISOString(),
        selections: [
          { teamName: "Mumbai Indians", oddsDecimal: 1.95 },
          { teamName: "Delhi Capitals", oddsDecimal: 2.0 },
        ],
      },
    ],
  };

  try {
    const res1 = await fetch(`${API_BASE}/api/odds/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(req1),
    });

    const data1 = await res1.json();
    console.log(`  Status: ${res1.status}`);

    if (res1.ok) {
      console.log(`  ✅ Response:`);
      console.log(`    - Odds A: ${data1.market.oddsA}`);
      console.log(`    - Odds B: ${data1.market.oddsB}`);
      console.log(`    - Model Prob A: ${data1.model.teamAWinProb.toFixed(4)}`);
      console.log(
        `    - Market Prob A (fair): ${data1.marketProbA_fair.toFixed(4)}`
      );
      console.log(`    - Edge A: ${data1.edgeA.toFixed(4)}`);
      console.log(
        `    - Significant Edge?: ${data1.isSignificantEdge ? "YES 🎯" : "No"}`
      );
    } else {
      console.error(`  ❌ Error:`, data1);
    }
  } catch (e) {
    console.error(`  ❌ Exception:`, (e as Error).message);
  }

  console.log();

  // Test 2: Missing admin key (should 401)
  console.log("Test 2️⃣  Missing admin key");
  try {
    const res2 = await fetch(`${API_BASE}/api/odds/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req1),
    });

    const data2 = await res2.json();
    console.log(`  Status: ${res2.status}`);

    if (res2.status === 401) {
      console.log(`  ✅ Correctly rejected (401)`);
    } else {
      console.log(`  ❌ Expected 401, got ${res2.status}`);
    }
  } catch (e) {
    console.error(`  ❌ Exception:`, (e as Error).message);
  }

  console.log();

  // Test 3: Invalid payload (one selection)
  console.log("Test 3️⃣  Invalid payload (only one selection)");
  const req3 = {
    matchId: TEST_MATCH_ID,
    timestamp: new Date().toISOString(),
    markets: [
      {
        marketName: "Match Winner",
        externalEventId: "ext-mw-002",
        observedAt: new Date().toISOString(),
        selections: [{ teamName: "Mumbai Indians", oddsDecimal: 1.85 }],
      },
    ],
  };

  try {
    const res3 = await fetch(`${API_BASE}/api/odds/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(req3),
    });

    const data3 = await res3.json();
    console.log(`  Status: ${res3.status}`);

    if (res3.status === 422) {
      console.log(`  ✅ Correctly rejected (422)`);
      console.log(`    Error: ${data3.error}`);
    } else {
      console.log(`  ❌ Expected 422, got ${res3.status}`);
    }
  } catch (e) {
    console.error(`  ❌ Exception:`, (e as Error).message);
  }

  console.log();

  // Test 4: Non-existent match
  console.log("Test 4️⃣  Non-existent match");
  const req4 = {
    ...req1,
    matchId: "nonexistent-match-id",
  };

  try {
    const res4 = await fetch(`${API_BASE}/api/odds/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(req4),
    });

    const data4 = await res4.json();
    console.log(`  Status: ${res4.status}`);

    if (res4.status === 404) {
      console.log(`  ✅ Correctly rejected (404)`);
      console.log(`    Error: ${data4.error}`);
    } else {
      console.log(`  ❌ Expected 404, got ${res4.status}`);
    }
  } catch (e) {
    console.error(`  ❌ Exception:`, (e as Error).message);
  }

  console.log();

  // Test 5: Missing odds for one side
  console.log("Test 5️⃣  Missing odds for one team (Mumbai missing)");
  const req5 = {
    matchId: TEST_MATCH_ID,
    timestamp: new Date().toISOString(),
    markets: [
      {
        marketName: "Match Winner",
        externalEventId: "ext-mw-005",
        observedAt: new Date().toISOString(),
        selections: [{ teamName: "Delhi Capitals", oddsDecimal: 2.25 }],
      },
    ],
  };

  try {
    const res5 = await fetch(`${API_BASE}/api/odds/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(req5),
    });

    const data5 = await res5.json();
    console.log(`  Status: ${res5.status}`);

    if (res5.status === 422) {
      console.log(`  ✅ Correctly rejected (422)`);
      console.log(`    Error: ${data5.error}`);
    } else {
      console.log(`  ❌ Expected 422, got ${res5.status}`);
    }
  } catch (e) {
    console.error(`  ❌ Exception:`, (e as Error).message);
  }

  console.log();
  console.log("✅ Odds Poll endpoint testing complete!");
}

testOddsPoll().catch(console.error).finally(() => process.exit(0));
