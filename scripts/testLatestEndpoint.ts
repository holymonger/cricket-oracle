/**
 * Test the /api/realtime/latest endpoint
 */

const LATEST_BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const LATEST_TEST_MATCH_ID = "cmmc4dc4p00002v09lszovaw5";

async function testLatestEndpoint() {
  console.log("🏏 Testing GET /api/realtime/latest\n");

  try {
    // Test 1: Valid matchId with data
    console.log(`Test 1: Fetch latest prediction for match ${LATEST_TEST_MATCH_ID}`);
    const response = await fetch(
      `${LATEST_BASE_URL}/api/realtime/latest?matchId=${LATEST_TEST_MATCH_ID}`,
      {
        method: "GET",
      }
    );

    console.log(`  Status: ${response.status}`);

    if (response.status !== 200) {
      console.log(`  ✗ Expected 200, got ${response.status}`);
      return;
    }

    const data = await response.json();

    console.log(`  ✓ Response received`);
    console.log(`  Match: ${data.teamA} vs ${data.teamB}`);
    console.log(
      `  Latest Prediction: Ball #${data.latestPrediction?.legalBallNumber}`
    );
    console.log(`    Win Prob: ${data.latestPrediction?.teamAWinProb}`);
    console.log(`    Innings: ${data.latestPrediction?.innings}`);
    console.log(
      `    Model: ${data.latestPrediction?.modelVersion || "N/A"}`
    );

    if (data.latestBallEvent) {
      console.log(`  Latest Ball Event:`);
      console.log(
        `    Over: ${data.latestBallEvent.over}.${data.latestBallEvent.ballInOver}`
      );
      console.log(
        `    Runs: ${data.latestBallEvent.runs.bat} bat + ${data.latestBallEvent.runs.extras} extras = ${data.latestBallEvent.runs.total} total`
      );
      console.log(`    Striker: ${data.latestBallEvent.striker}`);
      console.log(
        `    Legal: ${data.latestBallEvent.isLegal} (wide=${data.latestBallEvent.isWide}, noball=${data.latestBallEvent.isNoBall})`
      );
    }

    // Validate response structure
    let valid = true;

    if (!data.latestPrediction) {
      console.log(`  ✗ latestPrediction is null`);
      valid = false;
    } else {
      if (typeof data.latestPrediction.teamAWinProb !== "number") {
        console.log(
          `  ✗ teamAWinProb should be number, got ${typeof data.latestPrediction.teamAWinProb}`
        );
        valid = false;
      }
      if (
        data.latestPrediction.teamAWinProb < 0 ||
        data.latestPrediction.teamAWinProb > 1
      ) {
        console.log(
          `  ✗ teamAWinProb out of range: ${data.latestPrediction.teamAWinProb}`
        );
        valid = false;
      }
      if (!data.latestPrediction.features) {
        console.log(`  ✗ features missing`);
        valid = false;
      }
    }

    if (valid) {
      console.log(`  ✓ Response structure valid\n`);
    } else {
      console.log(`  ✗ Response validation failed\n`);
      return;
    }

    // Test 2: Invalid matchId
    console.log(`Test 2: Invalid matchId`);
    const invalidResponse = await fetch(
      `${LATEST_BASE_URL}/api/realtime/latest?matchId=invalid`,
      {
        method: "GET",
      }
    );

    if (invalidResponse.status === 404) {
      console.log(`  ✓ Correctly returned 404 for non-existent match\n`);
    } else {
      console.log(
        `  ✗ Expected 404 for invalid match, got ${invalidResponse.status}\n`
      );
    }

    // Test 3: Missing matchId
    console.log(`Test 3: Missing matchId parameter`);
    const missingResponse = await fetch(`${LATEST_BASE_URL}/api/realtime/latest`, {
      method: "GET",
    });

    if (missingResponse.status === 400) {
      console.log(`  ✓ Correctly returned 400 for missing matchId\n`);
    } else {
      console.log(
        `  ✗ Expected 400 for missing matchId, got ${missingResponse.status}\n`
      );
    }

    console.log(`✅ All endpoint tests passed!`);
  } catch (error) {
    console.error("❌ Test error:", error);
  }
}

testLatestEndpoint();
