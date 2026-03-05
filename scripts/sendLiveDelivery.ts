/**
 * Test script for real-time delivery ingestion
 * Tests targetRuns validation for innings 2
 */

const DELIVERY_ADMIN_KEY = process.env.ADMIN_KEY || "test-admin-key";
const DELIVERY_BASE_URL = process.env.BASE_URL || "http://localhost:3000";

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
  extras?: {
    wides?: number;
    noballs?: number;
    byes?: number;
    legbyes?: number;
  };
  wickets?: Array<Record<string, unknown>>;
  targetRuns?: number;
  provider?: string;
  providerEventId?: string;
}

async function sendDelivery(payload: DeliveryPayload): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${DELIVERY_BASE_URL}/api/realtime/delivery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": DELIVERY_ADMIN_KEY,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return { status: response.status, body };
}

async function runTests() {
  console.log("🏏 Cricket Oracle Real-time Delivery Tests\n");

  // Use a test match ID
  const matchId = `test-match-${Date.now()}`;
  const teamName = "Team A";

  try {
    // Test 1: Innings 1 delivery without targetRuns (should succeed)
    console.log("Test 1: Innings 1 without targetRuns (should succeed)...");
    const test1 = await sendDelivery({
      matchId,
      innings: 1,
      over: 0,
      ballInOver: 1,
      battingTeamName: teamName,
      strikerName: "Striker1",
      nonStrikerName: "NonStriker1",
      bowlerName: "Bowler1",
      runs: { total: 1 },
      provider: "test",
      providerEventId: `${matchId}:1:0:1`,
    });

    if (test1.status === 200) {
      console.log("✓ PASS: Innings 1 delivery accepted without targetRuns\n");
    } else {
      console.log(`✗ FAIL: Expected 200, got ${test1.status}`);
      console.log(`  Response: ${JSON.stringify(test1.body, null, 2)}\n`);
    }

    // Test 2: Innings 2 delivery without targetRuns (should fail with 422)
    console.log("Test 2: Innings 2 without targetRuns (should fail with 422)...");
    const test2 = await sendDelivery({
      matchId,
      innings: 2,
      over: 0,
      ballInOver: 1,
      battingTeamName: teamName,
      strikerName: "Striker2",
      nonStrikerName: "NonStriker2",
      bowlerName: "Bowler2",
      runs: { total: 2 },
      provider: "test",
      providerEventId: `${matchId}:2:0:1`,
    });

    if (test2.status === 422) {
      console.log("✓ PASS: Innings 2 delivery rejected without targetRuns (422)\n");
    } else {
      console.log(`✗ FAIL: Expected 422, got ${test2.status}`);
      console.log(`  Response: ${JSON.stringify(test2.body, null, 2)}\n`);
    }

    // Test 3: Innings 2 delivery with targetRuns (should succeed)
    console.log("Test 3: Innings 2 with targetRuns=100 (should succeed)...");
    const test3 = await sendDelivery({
      matchId,
      innings: 2,
      over: 0,
      ballInOver: 1,
      battingTeamName: teamName,
      strikerName: "Striker3",
      nonStrikerName: "NonStriker3",
      bowlerName: "Bowler3",
      runs: { total: 3 },
      targetRuns: 100,
      provider: "test",
      providerEventId: `${matchId}:2:0:2`,
    });

    if (test3.status === 200) {
      console.log("✓ PASS: Innings 2 delivery accepted with targetRuns\n");
    } else {
      console.log(`✗ FAIL: Expected 200, got ${test3.status}`);
      console.log(`  Response: ${JSON.stringify(test3.body, null, 2)}\n`);
    }

    // Test 4: Innings 2 delivery with conflicting targetRuns (should fail with 409)
    console.log("Test 4: Innings 2 with conflicting targetRuns (should fail with 409)...");
    const test4 = await sendDelivery({
      matchId,
      innings: 2,
      over: 0,
      ballInOver: 2,
      battingTeamName: teamName,
      strikerName: "Striker4",
      nonStrikerName: "NonStriker4",
      bowlerName: "Bowler4",
      runs: { total: 4 },
      targetRuns: 120,
      provider: "test",
      providerEventId: `${matchId}:2:0:3`,
    });

    if (test4.status === 409) {
      console.log("✓ PASS: Innings 2 delivery rejected with conflicting targetRuns (409)\n");
      console.log(`  Response: ${JSON.stringify(test4.body, null, 2)}\n`);
    } else {
      console.log(`✗ FAIL: Expected 409, got ${test4.status}`);
      console.log(`  Response: ${JSON.stringify(test4.body, null, 2)}\n`);
    }

    // Test 5: Innings 2 delivery with same targetRuns (should succeed)
    console.log("Test 5: Innings 2 with matching targetRuns (should succeed)...");
    const test5 = await sendDelivery({
      matchId,
      innings: 2,
      over: 0,
      ballInOver: 3,
      battingTeamName: teamName,
      strikerName: "Striker5",
      nonStrikerName: "NonStriker5",
      bowlerName: "Bowler5",
      runs: { total: 5 },
      targetRuns: 100,
      provider: "test",
      providerEventId: `${matchId}:2:0:4`,
    });

    if (test5.status === 200) {
      console.log("✓ PASS: Innings 2 delivery accepted with matching targetRuns\n");
    } else {
      console.log(`✗ FAIL: Expected 200, got ${test5.status}`);
      console.log(`  Response: ${JSON.stringify(test5.body, null, 2)}\n`);
    }

    console.log("🎯 Test suite completed!");
  } catch (error) {
    console.error("❌ Test error:", error);
  }
}

runTests();
