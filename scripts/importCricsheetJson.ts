import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CricsheetMatch {
  info: {
    dates: string[];
    teams: string[];
    venue?: string;
    city?: string;
    registry?: {
      people?: Record<string, string>;
    };
    players?: Record<string, string[]>;
    outcome?: {
      winner?: string;
      by?: any;
    };
    toss?: {
      winner?: string;
      decision?: string;
    };
  };
  innings: Array<{
    team: string;
    overs: Array<{
      over: number;
      deliveries: Array<{
        bowler: string;
        batter: string;
        non_striker: string;
        runs?: {
          batter?: number;
          extras?: number;
          total: number;
        };
        extras?: {
          wides?: number;
          noballs?: number;
          byes?: number;
          legbyes?: number;
          penalty?: number;
        };
        wickets?: Array<{
          player_out?: string;
          kind?: string;
          how?: string;
        }>;
      }>;
    }>;
  }>;
}

async function importCricsheetFile(filePath: string): Promise<void> {
  console.log(`\n📂 Importing: ${filePath}`);

  // Read and parse JSON
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const data: CricsheetMatch = JSON.parse(fileContent);

  // Extract basic info
  const sourceMatchId = path.basename(filePath, ".json");
  const matchDate = data.info.dates?.[0]
    ? new Date(data.info.dates[0])
    : undefined;
  const venue = data.info.venue;
  const city = data.info.city;
  const teamAName = data.info.teams[0];
  const teamBName = data.info.teams[1];
  const registry = data.info.registry?.people || {};

  // Determine winner and toss winner
  const outcomeName = data.info.outcome?.winner;
  const winnerTeam =
    outcomeName === teamAName ? "A" : outcomeName === teamBName ? "B" : null;

  const tossPerson = data.info.toss?.winner;
  const tossWinnerTeam =
    tossPerson === teamAName ? "A" : tossPerson === teamBName ? "B" : null;
  const tossDecision = data.info.toss?.decision;

  // Create or update Match
  // Try to find existing match
  let match = await prisma.match.findFirst({
    where: {
      source: "cricsheet",
      sourceMatchId,
    },
  });

  if (match) {
    // Update existing match
    match = await prisma.match.update({
      where: { id: match.id },
      data: {
        teamA: teamAName,
        teamB: teamBName,
        matchDate,
        venue,
        city,
        teamAName,
        teamBName,
        winnerTeam,
        tossWinnerTeam,
        tossDecision,
      },
    });
  } else {
    // Create new match
    match = await prisma.match.create({
      data: {
        teamA: teamAName,
        teamB: teamBName,
        source: "cricsheet",
        sourceMatchId,
        matchDate,
        venue,
        city,
        teamAName,
        teamBName,
        winnerTeam,
        tossWinnerTeam,
        tossDecision,
      },
    });
  }

  console.log(`✓ Match: ${teamAName} vs ${teamBName} (ID: ${match.id})`);

  // Collect all player names from all innings
  const allPlayerNames = new Set<string>();
  for (const inn of data.innings) {
    for (const over of inn.overs) {
      for (const delivery of over.deliveries) {
        allPlayerNames.add(delivery.batter);
        allPlayerNames.add(delivery.bowler);
        allPlayerNames.add(delivery.non_striker);
        if (delivery.wickets) {
          for (const wicket of delivery.wickets) {
            if (wicket.player_out) {
              allPlayerNames.add(wicket.player_out);
            }
          }
        }
      }
    }
  }

  // Upsert players
  const playerMap = new Map<string, string>(); // name -> id

  for (const playerName of allPlayerNames) {
    const externalId = registry[playerName] || null;
    const player = await prisma.player.upsert({
      where: {
        externalId: externalId || undefined,
      },
      create: {
        name: playerName,
        externalId,
      },
      update: {
        // Already exists
      },
    });
    playerMap.set(playerName, player.id);
  }

  console.log(`✓ Players: ${playerMap.size} records`);

  // Upsert MatchPlayers
  const players = data.info.players || {};
  const teamAPlayers = players[teamAName] || [];
  const teamBPlayers = players[teamBName] || [];

  // Clear existing match players for this match
  // (optional - use deleteMany if you want clean import)
  // await prisma.matchPlayer.deleteMany({ where: { matchId: match.id } });

  for (const playerName of teamAPlayers) {
    const playerId = playerMap.get(playerName);
    if (playerId) {
      await prisma.matchPlayer.upsert({
        where: {
          matchId_playerId: {
            matchId: match.id,
            playerId,
          },
        },
        create: {
          matchId: match.id,
          playerId,
          team: "A",
        },
        update: {},
      });
    }
  }

  for (const playerName of teamBPlayers) {
    const playerId = playerMap.get(playerName);
    if (playerId) {
      await prisma.matchPlayer.upsert({
        where: {
          matchId_playerId: {
            matchId: match.id,
            playerId,
          },
        },
        create: {
          matchId: match.id,
          playerId,
          team: "B",
        },
        update: {},
      });
    }
  }

  // Delete existing ball events for this match (for clean re-import)
  await prisma.ballEvent.deleteMany({ where: { matchId: match.id } });

  // Insert BallEvents
  let totalBallEvents = 0;
  let inningsCount = 0;

  for (const inn of data.innings) {
    inningsCount++;
    const battingTeamName = inn.team;
    const battingTeam = battingTeamName === teamAName ? "A" : "B";
    let legalBallNumber = 0; // Track legal balls (0-120 per innings)

    for (const over of inn.overs) {
      for (const delivery of over.deliveries) {
        const isWide = (delivery.extras?.wides || 0) > 0;
        const isNoBall = (delivery.extras?.noballs || 0) > 0;

        // Increment legal ball number only for legal deliveries
        let currentLegalBallNumber: number | null = null;
        if (!isWide && !isNoBall) {
          legalBallNumber++;
          currentLegalBallNumber = legalBallNumber;
        }

        const strikerId = playerMap.get(delivery.batter);
        const nonStrikerId = playerMap.get(delivery.non_striker);
        const bowlerId = playerMap.get(delivery.bowler);

        if (!strikerId || !nonStrikerId || !bowlerId) {
          console.warn(
            `⚠️  Skipping delivery: missing player (batter: ${delivery.batter}, non_striker: ${delivery.non_striker}, bowler: ${delivery.bowler})`
          );
          continue;
        }

        const runsBat = delivery.runs?.batter || 0;
        const runsExtras =
          (delivery.extras?.wides || 0) +
          (delivery.extras?.noballs || 0) +
          (delivery.extras?.byes || 0) +
          (delivery.extras?.legbyes || 0) +
          (delivery.extras?.penalty || 0);
        const runsTotal = delivery.runs?.total || 0;

        const isWicket = (delivery.wickets?.length || 0) > 0;

        await prisma.ballEvent.create({
          data: {
            matchId: match.id,
            innings: inningsCount,
            over: over.over,
            ballInOver: delivery.bowler ? 1 : 0, // Simplified - may need refinement
            legalBallNumber: currentLegalBallNumber,
            battingTeam,
            strikerId,
            nonStrikerId,
            bowlerId,
            runsBat,
            runsExtras,
            runsTotal,
            extrasJson: delivery.extras as any,
            isWide,
            isNoBall,
            isWicket,
            wicketJson: delivery.wickets as any,
          },
        });

        totalBallEvents++;
      }
    }
  }

  console.log(`✓ Ball events: ${totalBallEvents} deliveries`);
  console.log(`✓ Winner: ${winnerTeam ? `Team ${winnerTeam}` : "N/A"}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: tsx importCricsheetJson.ts <file1> [file2] ...");
    console.error("Example: tsx importCricsheetJson.ts data/335982.json");
    process.exit(1);
  }

  for (const filePath of args) {
    try {
      await importCricsheetFile(filePath);
    } catch (error) {
      console.error(`✗ Error importing ${filePath}:`, error);
    }
  }

  console.log("\n✓ Import complete!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
