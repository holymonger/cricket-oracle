const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');

const prisma = new PrismaClient();

async function testBallEventsProvider() {
  try {
    // Find a match with BallEvent data
    console.log('🔍 Finding match with BallEvent data...\n');
    
    const matchesWithBalls = await prisma.match.findMany({
      where: {
        ballEvents: {
          some: {
            legalBallNumber: {
              not: null
            }
          }
        }
      },
      include: {
        _count: {
          select: { ballEvents: true }
        }
      },
      take: 1
    });

    if (!matchesWithBalls.length) {
      console.log('❌ No matches with BallEvent data found');
      return;
    }

    const match = matchesWithBalls[0];
    console.log(`✅ Found match: ${match.title}`);
    console.log(`   ID: ${match.id}`);
    console.log(`   BallEvents: ${match._count.ballEvents}`);
    console.log(`   Teams: ${match.teamA} vs ${match.teamB}\n`);

    // Reset first to start fresh
    console.log('🔄 Resetting provider state...');
    const resetResp = await fetch('http://localhost:3000/api/realtime/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'Mountain111'
      },
      body: JSON.stringify({ matchId: match.id })
    });
    
    if (!resetResp.ok) {
      console.error('Reset failed:', await resetResp.text());
      return;
    }
    
    const resetData = await resetResp.json();
    console.log('✅ Reset complete:', resetData.deleted, '\n');

    // Call tick endpoint with ball-events provider
    console.log('🎯 Calling /api/realtime/tick with liveProvider="ball-events"...\n');
    
    const tickResp = await fetch('http://localhost:3000/api/realtime/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'Mountain111'
      },
      body: JSON.stringify({
        matchId: match.id,
        liveProvider: 'ball-events'
      })
    });

    if (!tickResp.ok) {
      console.error('❌ Tick failed:', tickResp.status);
      console.error(await tickResp.text());
      return;
    }

    const tickData = await tickResp.json();
    console.log('✅ Tick response:');
    console.log(JSON.stringify(tickData, null, 2));

    // Verify database state
    console.log('\n📊 Verifying database state...\n');
    
    const liveBalls = await prisma.liveBallEvent.count({
      where: { matchId: match.id }
    });
    
    const predictions = await prisma.ballPrediction.count({
      where: { matchId: match.id }
    });

    const cursor = await prisma.liveProviderCursor.findUnique({
      where: {
        matchId_provider: { matchId: match.id, provider: 'ball-events' }
      }
    });

    console.log(`📝 LiveBallEvent rows: ${liveBalls}`);
    console.log(`🔮 BallPrediction rows: ${predictions}`);
    console.log(`🔖 Provider cursor: ${cursor?.cursor || 'null'}`);

    if (predictions > 0) {
      const lastPred = await prisma.ballPrediction.findFirst({
        where: { matchId: match.id },
        orderBy: { createdAt: 'desc' }
      });
      console.log(`\n   Last prediction: innings=${lastPred.innings}, legalBallNumber=${lastPred.legalBallNumber}`);
    }

    // Call tick again to see next delivery
    console.log('\n🎯 Calling tick again for next delivery...\n');
    
    const tick2Resp = await fetch('http://localhost:3000/api/realtime/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'Mountain111'
      },
      body: JSON.stringify({
        matchId: match.id,
        liveProvider: 'ball-events'
      })
    });

    const tick2Data = await tick2Resp.json();
    console.log('✅ Second tick response:');
    console.log(JSON.stringify(tick2Data, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testBallEventsProvider();
