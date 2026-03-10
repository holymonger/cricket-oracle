/**
 * Bulk import Cricsheet match METADATA only — no ball events, no players.
 *
 * Writes only the Match row per file (~1KB each vs ~5MB for full import).
 * Fits all 1170 IPL matches in ~1.2MB of DB storage.
 *
 * Use this for pre-match H2H stats, team form, venue analysis.
 * Use the full importCricsheetJson.ts only for matches you want live replay.
 *
 * Usage:
 *   npx tsx scripts/bulkImportMetadata.ts <directory> [competition]
 *
 * Examples:
 *   npx tsx scripts/bulkImportMetadata.ts ../ipl_json ipl
 *   npx tsx scripts/bulkImportMetadata.ts ../t20s_json t20i
 */

import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CricsheetInfo {
  dates: string[];
  teams: string[];
  venue?: string;
  city?: string;
  outcome?: { winner?: string };
  toss?: { winner?: string; decision?: string };
  innings1Runs?: number;
  innings2Runs?: number;
}

interface CricsheetMatch {
  info: CricsheetInfo & {
    registry?: { people?: Record<string, string> };
    players?: Record<string, string[]>;
  };
  innings?: Array<{ team: string; overs: Array<{ deliveries: Array<{ runs?: { total: number }; wickets?: unknown[] }> }> }>;
}

function computeInningsTotals(data: CricsheetMatch): { i1Runs: number; i2Runs: number; i1Wickets: number; i2Wickets: number } {
  let i1Runs = 0, i2Runs = 0, i1Wickets = 0, i2Wickets = 0;
  for (let i = 0; i < Math.min((data.innings ?? []).length, 2); i++) {
    let runs = 0, wickets = 0;
    for (const over of data.innings![i].overs) {
      for (const d of over.deliveries) {
        runs += d.runs?.total ?? 0;
        if (Array.isArray(d.wickets)) wickets += d.wickets.length;
      }
    }
    if (i === 0) { i1Runs = runs; i1Wickets = wickets; }
    else { i2Runs = runs; i2Wickets = wickets; }
  }
  return { i1Runs, i2Runs, i1Wickets, i2Wickets };
}

interface ParsedMatch {
  sourceMatchId: string;
  teamA: string;
  teamB: string;
  teamAName: string;
  teamBName: string;
  winnerTeam: string | null;
  tossWinnerTeam: string | null;
  tossDecision: string | null;
  matchDate: Date | null;
  venue: string | null;
  city: string | null;
  innings1Runs: number;
  innings2Runs: number;
  innings1Wickets: number;
  innings2Wickets: number;
  // name -> { externalId, side }
  players: Map<string, { externalId: string | null; side: "A" | "B" }>;
}

function parseFile(filePath: string): ParsedMatch | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: CricsheetMatch = JSON.parse(raw);
  const info = data.info;

  if (!info.teams || info.teams.length < 2) return null;
  if (!info.outcome?.winner) return null;

  const sourceMatchId = path.basename(filePath, ".json");
  const rawTeam1 = info.teams[0];
  const rawTeam2 = info.teams[1];
  const [normalizedTeamA, normalizedTeamB] =
    rawTeam1.localeCompare(rawTeam2) <= 0
      ? [rawTeam1, rawTeam2]
      : [rawTeam2, rawTeam1];

  const toSide = (name: string): "A" | "B" =>
    name === normalizedTeamA ? "A" : "B";

  const registry = info.registry?.people ?? {};
  const players = new Map<string, { externalId: string | null; side: "A" | "B" }>();
  for (const [teamName, playerNames] of Object.entries(info.players ?? {})) {
    const side = toSide(teamName);
    for (const name of playerNames) {
      players.set(name, { externalId: registry[name] ?? null, side });
    }
  }

  const { i1Runs, i2Runs, i1Wickets, i2Wickets } = computeInningsTotals(data);

  return {
    sourceMatchId,
    teamA: normalizedTeamA,
    teamB: normalizedTeamB,
    teamAName: rawTeam1,
    teamBName: rawTeam2,
    winnerTeam: toSide(info.outcome.winner!),
    tossWinnerTeam: info.toss?.winner ? toSide(info.toss.winner) : null,
    tossDecision: info.toss?.decision ?? null,
    matchDate: info.dates?.[0] ? new Date(info.dates[0]) : null,
    venue: info.venue ?? null,
    city: info.city ?? null,
    innings1Runs: i1Runs,
    innings2Runs: i2Runs,
    innings1Wickets: i1Wickets,
    innings2Wickets: i2Wickets,
    players,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  const competition = args[1] ?? "unknown";

  if (!dir) {
    console.error("Usage: npx tsx scripts/bulkImportMetadata.ts <directory> [competition]");
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort();

  console.log(`\nBulk metadata import: ${files.length} files from ${dir}`);
  console.log(`Competition tag: ${competition}`);

  // ── Step 1: Parse all files locally (no DB) ──────────────────────────────
  console.log(`\nParsing ${files.length} JSON files...`);
  const parsed: ParsedMatch[] = [];
  let parseSkipped = 0;
  for (const f of files) {
    try {
      const m = parseFile(f);
      if (m) parsed.push(m); else parseSkipped++;
    } catch { parseSkipped++; }
  }
  console.log(`  ${parsed.length} valid, ${parseSkipped} skipped (no result/incomplete)`);

  // ── Step 2: Load existing sourceMatchIds to know what needs inserting ─────
  console.log(`\nChecking existing matches in DB...`);
  const existingMatches = await prisma.match.findMany({
    where: { source: "cricsheet" },
    select: { id: true, sourceMatchId: true },
  });
  const existingMap = new Map(existingMatches.map((m) => [m.sourceMatchId!, m.id]));
  const toInsert = parsed.filter((m) => !existingMap.has(m.sourceMatchId));
  const toUpdate = parsed.filter((m) => existingMap.has(m.sourceMatchId));
  console.log(`  ${toInsert.length} to insert, ${toUpdate.length} to update`);

  // ── Step 3: Insert new matches in batches ─────────────────────────────────
  const BATCH = 50;
  console.log(`\nInserting ${toInsert.length} matches in batches of ${BATCH}...`);
  const startTime = Date.now();
  let inserted = 0;

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((m) =>
        prisma.match.create({
          data: {
            teamA: m.teamA, teamB: m.teamB, source: "cricsheet",
            sourceMatchId: m.sourceMatchId, matchDate: m.matchDate,
            venue: m.venue, city: m.city,
            teamAName: m.teamAName, teamBName: m.teamBName,
            winnerTeam: m.winnerTeam, tossWinnerTeam: m.tossWinnerTeam,
            tossDecision: m.tossDecision,
            innings1Runs: m.innings1Runs, innings2Runs: m.innings2Runs,
            innings1Wickets: m.innings1Wickets, innings2Wickets: m.innings2Wickets,
          },
        })
      )
    );
    inserted += batch.length;
    if ((i + BATCH) % 200 === 0 || i + BATCH >= toInsert.length) {
      console.log(`  inserted ${inserted}/${toInsert.length} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
    }
  }

  // Update changed matches
  if (toUpdate.length > 0) {
    console.log(`\nUpdating ${toUpdate.length} existing matches...`);
    for (const m of toUpdate) {
      const id = existingMap.get(m.sourceMatchId)!;
      await prisma.match.update({
        where: { id },
        data: {
          teamA: m.teamA, teamB: m.teamB, matchDate: m.matchDate,
          venue: m.venue, city: m.city,
          teamAName: m.teamAName, teamBName: m.teamBName,
          winnerTeam: m.winnerTeam, tossWinnerTeam: m.tossWinnerTeam,
          tossDecision: m.tossDecision,
          innings1Runs: m.innings1Runs, innings2Runs: m.innings2Runs,
          innings1Wickets: m.innings1Wickets, innings2Wickets: m.innings2Wickets,
        },
      });
    }
    console.log(`  done`);
  }

  // ── Step 4: Re-fetch all match IDs (including newly inserted) ─────────────
  const allMatches = await prisma.match.findMany({
    where: { source: "cricsheet" },
    select: { id: true, sourceMatchId: true },
  });
  const matchIdMap = new Map(allMatches.map((m) => [m.sourceMatchId!, m.id]));

  // ── Step 5: Collect all unique player names across all files ──────────────
  console.log(`\nResolving players...`);
  const allPlayerNames = new Map<string, string | null>(); // name -> externalId
  for (const m of parsed) {
    for (const [name, { externalId }] of m.players) {
      if (!allPlayerNames.has(name)) allPlayerNames.set(name, externalId);
    }
  }
  console.log(`  ${allPlayerNames.size} unique players across all matches`);

  // Load existing players into memory cache
  const existingPlayers = await prisma.player.findMany({ select: { id: true, name: true } });
  const playerCache = new Map(existingPlayers.map((p) => [p.name, p.id]));

  // Create any missing players in batches
  const missingPlayers = [...allPlayerNames.entries()].filter(([name]) => !playerCache.has(name));
  console.log(`  ${missingPlayers.length} new players to create`);

  for (let i = 0; i < missingPlayers.length; i += BATCH) {
    const batch = missingPlayers.slice(i, i + BATCH);
    for (const [name, externalId] of batch) {
      try {
        let player: { id: string; name: string } | null = null;
        if (externalId) {
          // Upsert by externalId (handles duplicate registry IDs)
          player = await prisma.player.upsert({
            where: { externalId },
            update: {},
            create: { name, externalId },
            select: { id: true, name: true },
          });
        } else {
          player = await prisma.player.create({ data: { name }, select: { id: true, name: true } });
        }
        playerCache.set(player.name, player.id);
      } catch {
        // Already exists with same name — find it
        const existing = await prisma.player.findFirst({ where: { name }, select: { id: true, name: true } });
        if (existing) playerCache.set(existing.name, existing.id);
      }
    }
  }
  console.log(`  player cache: ${playerCache.size} total`);

  // ── Step 6: Insert MatchPlayers in batches ────────────────────────────────
  console.log(`\nInserting MatchPlayer records...`);

  // Load existing MatchPlayers to avoid duplicates
  const existingMPs = await prisma.matchPlayer.findMany({ select: { matchId: true, playerId: true } });
  const mpSet = new Set(existingMPs.map((mp) => `${mp.matchId}:${mp.playerId}`));

  const mpToInsert: { matchId: string; playerId: string; team: string }[] = [];
  for (const m of parsed) {
    const matchId = matchIdMap.get(m.sourceMatchId);
    if (!matchId) continue;
    for (const [name, { side }] of m.players) {
      const playerId = playerCache.get(name);
      if (!playerId) continue;
      const key = `${matchId}:${playerId}`;
      if (!mpSet.has(key)) {
        mpToInsert.push({ matchId, playerId, team: side });
        mpSet.add(key);
      }
    }
  }

  console.log(`  ${mpToInsert.length} MatchPlayer records to insert`);
  let mpInserted = 0;
  for (let i = 0; i < mpToInsert.length; i += BATCH) {
    const batch = mpToInsert.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((mp) => prisma.matchPlayer.create({ data: mp }))
    );
    mpInserted += batch.length;
    if (mpInserted % 1000 === 0 || mpInserted >= mpToInsert.length) {
      console.log(`  ${mpInserted}/${mpToInsert.length} MatchPlayers inserted`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  Matches inserted: ${inserted}`);
  console.log(`  Matches updated:  ${toUpdate.length}`);
  console.log(`  Matches skipped:  ${parseSkipped}`);
  console.log(`  Players created:  ${missingPlayers.length}`);
  console.log(`  MatchPlayers:     ${mpInserted}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
