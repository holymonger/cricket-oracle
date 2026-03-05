/**
 * Test script to verify live delivery ingestion
 * Sends 5 deliveries and verifies responses + database
 */

import { prisma } from "@/lib/db/prisma";

const ADMIN_KEY = process.env.ADMIN_KEY || "test-admin-key";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function getTestMatch() {
  const match = await prisma.match.findFirst({
    select: { id: true, teamA: true, teamB: true },
  });

  if (!match) {
    throw new Error("No matches found in database");
  }

  return match;
}

interface DeliveryPayload {
  matchId: string;
  innings: number;
  over: number;
  ballInOver: number;
  battingTeamName: string;
  strikerName: string;
  nonStrikerName: string;
  bowlerName: string;
  runs: {
    total: number;
    bat?: number;
    extras?: number;
  };
  targetRuns?: number;
  provider?: string;
  providerEventId?: string;
}

async function sendDelivery(payload: DeliveryPayload) {
  const response = await fetch(`${BASE_URL}/api/realtime/delivery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_KEY,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return { status: response.status, body };
}

async function verifyPrediction(
  matchId: string,
  innings: number,
  legalBallNumber: number
) {
  const prediction = await prisma.ballPrediction.findUnique({
    where: {
      matchId_innings_legalBallNumber_modelVersion: {
        matchId,
        innings,
        legalBallNumber,
        modelVersion: "v3-lgbm",
      },
    },
    select: {
      legalBallNumber: true,
      teamAWinProb: true,
      featuresJson: true,
    },
  });

  return prediction;
}

async function runTests() {
  console.log("🏏 Testing Live Delivery Ingestion\n");

  try {
    const match = await getTestMatch();
    console.log(`Using match: ${match.teamA} vs ${match.teamB}`);
    console.log(`Match ID: ${match.id}\n`);

    const deliveries: DeliveryPayload[] = [
      {
        matchId: match.id,
        innings: 1,
        over: 0,
        ballInOver: 1,
        battingTeamName: match.teamA,
        strikerName: "Striker1",
        nonStrikerName: "NonStriker1",
        bowlerName: "Bowler1",
        runs: { total: 1 },
        provider: "test",
        providerEventId: `${match.id}:1:0:1`,
      },
      {
        matchId: match.id,
        innings: 1,
        over: 0,
        ballInOver: 2,
        battingTeamName: match.teamA,
        strikerName: "Striker1",
        nonStrikerName: "NonStriker1",
        bowlerName: "Bowler1",
        runs: { total: 2 },
        provider: "test",
        providerEventId: `${match.id}:1:0:2`,
      },
      {
        matchId: match.id,
        innings: 1,
        over: 0,
        ballInOver: 3,
        battingTeamName: match.teamA,
        strikerName: "Striker1",
        nonStrikerName: "NonStriker1",
        bowlerName: "Bowler1",
        runs: { total: 0 },
        provider: "test",
        providerEventId: `${match.id}:1:0:3`,
      },
      {
        matchId: match.id,
        innings: 1,
        over: 0,
        ballInOver: 4,
        battingTeamName: match.teamA,
        strikerName: "Striker1",
        nonStrikerName: "NonStriker1",
        bowlerName: "Bowler1",
        runs: { total: 4 },
        provider: "test",
        providerEventId: `${match.id}:1:0:4`,
      },
      {
        matchId: match.id,
        innings: 1,
        over: 0,
        ballInOver: 5,
        battingTeamName: match.teamA,
        strikerName: "Striker1",
        nonStrikerName: "NonStriker1",
        bowlerName: "Bowler1",
        runs: { total: 3 },
        provider: "test",
        providerEventId: `${match.id}:1:0:5`,
      },
    ];

    let passCount = 0;
    let failCount = 0;

    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      console.log(`\n📍 Delivery ${i + 1}:`);
      console.log(`    Over: ${delivery.over}, Ball: ${delivery.ballInOver}`);
      console.log(`    Runs: ${delivery.runs.total}`);

      // Send delivery
      const response = await sendDelivery(delivery);

      if (response.status !== 200) {
        console.log(`  ✗ POST failed with status ${response.status}`);
        console.log(`    Error: ${response.body.error}`);
        failCount++;
        continue;
      }

      const { isLegal, legalBallNumber, teamAWinProb } = response.body;

      console.log(`  ✓ POST succeeded`);
      console.log(`    Legal: ${isLegal}`);
      console.log(`    Legal Ball #: ${legalBallNumber}`);
      console.log(`    Team A Win Prob: ${teamAWinProb}`);

      // Verify response format
      let responseOk = true;
      if (!isLegal) {
        console.log(`  ✗ Expected legal ball but got isLegal=false`);
        responseOk = false;
        failCount++;
      } else if (legalBallNumber !== i + 1) {
        console.log(`  ✗ Expected legalBallNumber=${i + 1}, got ${legalBallNumber}`);
        responseOk = false;
        failCount++;
      } else if (typeof teamAWinProb !== "number" || teamAWinProb < 0 || teamAWinProb > 1) {
        console.log(`  ✗ teamAWinProb should be 0-1, got ${teamAWinProb}`);
        responseOk = false;
        failCount++;
      }

      if (responseOk) {
        console.log(`  ✓ Response format valid`);
      }

      // Verify database
      await new Promise((r) => setTimeout(r, 100)); // Small delay for DB durability
      const prediction = await verifyPrediction(match.id, 1, legalBallNumber!);

      if (!prediction) {
        console.log(`  ✗ No BallPrediction found in database`);
        failCount++;
      } else {
        console.log(`  ✓ BallPrediction created in database`);
        console.log(`    Stored winProb: ${prediction.teamAWinProb}`);
        passCount++;
      }
    }

    console.log(`\n\n📊 Results:`);
    console.log(`  ✓ Passed: ${passCount + (failCount === 0 ? 5 : 0)}`);
    console.log(`  ✗ Failed: ${failCount}`);

    if (failCount === 0) {
      console.log(`\n✅ All tests passed! Live delivery ingestion is working.`);
    } else {
      console.log(`\n⚠️  Some tests failed. Check logs above.`);
    }
  } catch (error) {
    console.error("❌ Test error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
