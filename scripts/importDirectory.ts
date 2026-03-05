import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface CricsheetMatch {
  info: {
    balls_per_over?: number;
    city?: string;
    dates?: string[];
    event?: { name?: string };
    gender?: string;
    match_type?: string;
    match_type_number?: number;
    outcome?: {
      winner?: string;
      by?: { runs?: number; wickets?: number };
      result?: string;
    };
    overs?: number;
    player_of_match?: string[];
    players?: Record<string, string[]>;
    registry?: { people?: Record<string, string> };
    season?: string;
    team_type?: string;
    teams?: string[];
    toss?: {
      winner?: string;
      decision?: string;
    };
    venue?: string;
  };
  innings: Array<{
    team: string;
    overs: Array<{
      over: number;
      deliveries: Array<{
        batter: string;
        bowler: string;
        non_striker: string;
        runs: {
          batter: number;
          extras: number;
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
          player_out: string;
          kind: string;
          fielders?: Array<{ name: string }>;
        }>;
      }>;
    }>;
  }>;
}

async function importCricsheetFile(filePath: string): Promise<void> {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const data: CricsheetMatch = JSON.parse(fileContent);

  const sourceMatchId = path.basename(filePath, ".json");
  const teamAName = data.info.teams?.[0] || "Team A";
  const teamBName = data.info.teams?.[1] || "Team B";
  const matchDate = data.info.dates?.[0]
    ? new Date(data.info.dates[0])
    : undefined;
  const venue = data.info.venue;
  const city = data.info.city;

  const outcomeName = data.info.outcome?.winner;
  const winnerTeam =
    outcomeName === teamAName
      ? "A"
      : outcomeName === teamBName
      ? "B"
      : null;

  const tossWinnerName = data.info.toss?.winner;
  const tossWinnerTeam =
    tossWinnerName === teamAName
      ? "A"
      : tossWinnerName === teamBName
      ? "B"
      : null;
  const tossDecision = data.info.toss?.decision;

  // Check if match already exists
  const existingMatch = await prisma.match.findFirst({
    where: {
      source: "cricsheet",
      sourceMatchId: sourceMatchId,
    },
  });

  let match;
  if (existingMatch) {
    match = await prisma.match.update({
      where: { id: existingMatch.id },
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
  } else {
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

  // Upsert players
  const playerMap = new Map<string, string>();
  const registry = data.info.registry?.people || {};

  const allPlayerNames = new Set<string>();
  for (const team of Object.keys(data.info.players || {})) {
    for (const playerName of data.info.players![team]) {
      allPlayerNames.add(playerName);
    }
  }
  for (const inn of data.innings) {
    for (const over of inn.overs) {
      for (const delivery of over.deliveries) {
        allPlayerNames.add(delivery.batter);
        allPlayerNames.add(delivery.bowler);
        allPlayerNames.add(delivery.non_striker);
      }
    }
  }

  for (const playerName of allPlayerNames) {
    const externalId = registry[playerName];
    let player = await prisma.player.findFirst({
      where: externalId ? { externalId } : { name: playerName },
    });

    if (!player) {
      player = await prisma.player.create({
        data: {
          name: playerName,
          externalId: externalId || undefined,
        },
      });
    }

    playerMap.set(playerName, player.id);
  }

  // Link players to match
  await prisma.matchPlayer.deleteMany({ where: { matchId: match.id } });
  for (const teamName of Object.keys(data.info.players || {})) {
    const team = teamName === teamAName ? "A" : "B";
    for (const playerName of data.info.players![teamName]) {
      const playerId = playerMap.get(playerName);
      if (playerId) {
        await prisma.matchPlayer.create({
          data: {
            matchId: match.id,
            playerId,
            team,
          },
        });
      }
    }
  }

  // Delete existing ball events
  await prisma.ballEvent.deleteMany({ where: { matchId: match.id } });

  // Insert ball events
  for (const inn of data.innings) {
    const inningsNumber = data.innings.indexOf(inn) + 1;
    const battingTeam = inn.team === teamAName ? "A" : "B";
    let legalBallNumber = 0;

    for (const over of inn.overs) {
      for (const delivery of over.deliveries) {
        const strikerId = playerMap.get(delivery.batter);
        const nonStrikerId = playerMap.get(delivery.non_striker);
        const bowlerId = playerMap.get(delivery.bowler);

        if (!strikerId || !nonStrikerId || !bowlerId) {
          console.warn(
            `Skipping delivery: missing player ID for ${delivery.batter}/${delivery.non_striker}/${delivery.bowler}`
          );
          continue;
        }

        const isWide = !!(delivery.extras?.wides && delivery.extras.wides > 0);
        const isNoBall = !!(
          delivery.extras?.noballs && delivery.extras.noballs > 0
        );
        const isWicket = !!(delivery.wickets && delivery.wickets.length > 0);

        if (!isWide && !isNoBall) {
          legalBallNumber++;
        }

        await prisma.ballEvent.create({
          data: {
            matchId: match.id,
            innings: inningsNumber,
            over: over.over,
            ballInOver: 1,
            legalBallNumber: !isWide && !isNoBall ? legalBallNumber : undefined,
            battingTeam,
            strikerId,
            nonStrikerId,
            bowlerId,
            runsBat: delivery.runs.batter,
            runsExtras: delivery.runs.extras,
            runsTotal: delivery.runs.total,
            extrasJson: delivery.extras ? (delivery.extras as any) : undefined,
            isWide,
            isNoBall,
            isWicket,
            wicketJson: delivery.wickets
              ? (delivery.wickets as any)
              : undefined,
          },
        });
      }
    }
  }
}

async function importDirectory(dirPath: string, label: string): Promise<void> {
  console.log(`\n=== Importing ${label} from ${dirPath} ===\n`);

  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dirPath, f));

  console.log(`Found ${files.length} JSON files\n`);

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = path.basename(file);

    try {
      await importCricsheetFile(file);
      successful++;
      
      // Progress indicator every 50 files
      if ((i + 1) % 50 === 0) {
        console.log(
          `Progress: ${i + 1}/${files.length} (${successful} successful, ${failed} failed)`
        );
      }
    } catch (error) {
      failed++;
      console.error(`Error importing ${fileName}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\n✅ ${label} Import Complete:`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total: ${files.length}\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: tsx importDirectory.ts <directory-path> [label]");
    process.exit(1);
  }

  const dirPath = args[0];
  const label = args[1] || path.basename(dirPath);

  if (!fs.existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    process.exit(1);
  }

  await importDirectory(dirPath, label);
  await prisma.$disconnect();
}

main().catch(console.error);
