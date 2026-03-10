/**
 * Test Step 36: Dashboard with live series and market data
 */
const fetch = require("node-fetch");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function testDashboard() {
  const adminKey = "Mountain111";

  try {
    console.log("🏏 Step 36: Dashboard E2E Test\n");

    // 1. Find a match with BallEvent data
    console.log("1️⃣ Finding match with BallEvent data...");
    const match = await prisma.match.findFirst({
      where: {
        ballEvents: {
          some: {
            legalBallNumber: { not: null },
          },
        },
      },
      include: {
        _count: {
          select: { ballEvents: true },
        },
      },
    });

    if (!match) {
      console.log("❌ No match with BallEvent data found\n");
      return;
    }

    console.log(`✅ Found match: ${match.title}`);
    console.log(`   ID: ${match.id}`);
    console.log(`   BallEvents: ${match._count.ballEvents}\n`);

    // 2. Reset provider state
    console.log("2️⃣ Resetting provider state...");
    const resetResp = await fetch("http://localhost:3000/api/realtime/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ matchId: match.id }),
    });

    if (!resetResp.ok) {
      console.error(
        "❌ Reset failed:",
        resetResp.status,
        await resetResp.text()
      );
      return;
    }

    const resetData = await resetResp.json();
    console.log(`✅ Reset complete\n`);

    // 3. Run 5 ticks with ball-events provider
    console.log("3️⃣ Running 5 ticks with ball-events provider...");
    for (let i = 0; i < 5; i++) {
      const tickResp = await fetch("http://localhost:3000/api/realtime/tick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          matchId: match.id,
          liveProvider: "ball-events",
        }),
      });

      if (!tickResp.ok) {
        console.error(`   ❌ Tick ${i + 1} failed:`, tickResp.status);
        return;
      }

      const tickData = await tickResp.json();
      console.log(
        `   ✅ Tick ${i + 1}: innings=${tickData.prediction?.innings}, legalBallNumber=${tickData.prediction?.legalBallNumber}, winProb=${(tickData.prediction?.teamAWinProb * 100).toFixed(1)}%`
      );
    }
    console.log("");

    // 4. Fetch series data
    console.log("4️⃣ Fetching series data...");
    const seriesResp = await fetch(
      `http://localhost:3000/api/realtime/series?matchId=${match.id}&modelVersion=v3-lgbm&limit=240`,
      {
        headers: { "x-admin-key": adminKey },
      }
    );

    if (!seriesResp.ok) {
      console.error("❌ Series fetch failed:", seriesResp.status);
      return;
    }

    const seriesData = await seriesResp.json();
    console.log(`✅ Series data: ${seriesData.count} points`);
    if (seriesData.count > 0) {
      const first = seriesData.data[0];
      const last = seriesData.data[seriesData.count - 1];
      console.log(
        `   First: innings=${first.innings}, ball=${first.legalBallNumber}, winProb=${(first.teamAWinProb * 100).toFixed(1)}%`
      );
      console.log(
        `   Last: innings=${last.innings}, ball=${last.legalBallNumber}, winProb=${(last.teamAWinProb * 100).toFixed(1)}%`
      );
    }
    console.log("");

    // 5. Fetch market data
    console.log("5️⃣ Fetching market data...");
    const marketResp = await fetch(
      `http://localhost:3000/api/markets/latest?matchId=${match.id}`,
      {
        headers: { "x-admin-key": adminKey },
      }
    );

    if (!marketResp.ok) {
      console.error("❌ Market fetch failed:", marketResp.status);
      return;
    }

    const marketData = await marketResp.json();
    console.log("✅ Market data fetched");

    if (marketData.prediction) {
      console.log(
        `   Prediction: innings=${marketData.prediction.innings}, ball=${marketData.prediction.legalBallNumber}, winProb=${(marketData.prediction.teamAWinProb * 100).toFixed(1)}%`
      );
    }

    if (marketData.market) {
      console.log(
        `   Market: ${marketData.market.marketName}, oddsA=${marketData.market.oddsA?.toFixed(2)}, oddsB=${marketData.market.oddsB?.toFixed(2)}`
      );
    }

    if (marketData.edge) {
      console.log(
        `   Edge: ${marketData.edge.marketName}, edgeA=${(marketData.edge.edgeA * 100).toFixed(2)}%, stale=${marketData.edge.stale}, staleness=${marketData.edge.stalenessSeconds}s`
      );
    }
    console.log("");

    // 6. Verify database state
    console.log("6️⃣ Verifying database state...");
    const ballsCount = await prisma.liveBallEvent.count({
      where: { matchId: match.id },
    });

    const predsCount = await prisma.ballPrediction.count({
      where: { matchId: match.id },
    });

    console.log(`   LiveBallEvent rows: ${ballsCount}`);
    console.log(`   BallPrediction rows: ${predsCount}`);

    if (ballsCount > 0 && predsCount > 0) {
      console.log("   ✅ Data flowing through the system");
    } else {
      console.log("   ⚠️ No data in database");
    }
    console.log("");

    console.log("✨ Dashboard E2E test complete!\n");
    console.log("📊 Dashboard URL: http://localhost:3000/realtime/dashboard");
    console.log(`   Try with matchId: ${match.id}`);
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testDashboard();
