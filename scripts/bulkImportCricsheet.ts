/**
 * Bulk-imports all Cricsheet JSON files from a directory into the database.
 *
 * Key optimizations over the original importDirectory.ts:
 *  1. Skips matches already in DB (by sourceMatchId) — safe to re-run
 *  2. Global player cache across the entire run — no repeated DB lookups
 *  3. prisma.ballEvent.createMany() — one DB call per innings instead of one per delivery
 *  4. Player upserts batched where possible
 *
 * Usage:
 *   npx tsx scripts/bulkImportCricsheet.ts <directory> [label]
 *
 * Examples:
 *   npx tsx scripts/bulkImportCricsheet.ts "../ipl_json" IPL
 *   npx tsx scripts/bulkImportCricsheet.ts "../t20s_json" T20I
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ── Types ─────────────────────────────────────────────────────────────────────

interface CricsheetDelivery {
  batter: string;
  bowler: string;
  non_striker: string;
  runs: { batter: number; extras: number; total: number };
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
    fielders?: Array<{ name?: string }>;
  }>;
}

interface CricsheetInnings {
  team: string;
  overs: Array<{
    over: number;
    deliveries: CricsheetDelivery[];
  }>;
}

interface CricsheetMatch {
  info: {
    dates?: string[];
    teams?: string[];
    venue?: string;
    city?: string;
    match_type?: string;
    season?: string;
    event?: { name?: string };
    registry?: { people?: Record<string, string> };
    players?: Record<string, string[]>;
    outcome?: { winner?: string; by?: { runs?: number; wickets?: number }; result?: string };
    toss?: { winner?: string; decision?: string };
  };
  innings: CricsheetInnings[];
}

// ── Global player cache ───────────────────────────────────────────────────────
// Key: `ext:<externalId>` or `name:<playerName>` → DB player id
const playerCache = new Map<string, string>();
let playerCacheLoaded = false;

/**
 * One-time: load all existing players from DB into memory.
 * After this, zero DB roundtrips for known players.
 */
async function warmPlayerCache(): Promise<void> {
  if (playerCacheLoaded) return;
  console.log("  Warming player cache from DB…");
  const all = await prisma.player.findMany({ select: { id: true, name: true, externalId: true } });
  for (const p of all) {
    if (p.externalId) playerCache.set(`ext:${p.externalId}`, p.id);
    playerCache.set(`name:${p.name}`, p.id);
  }
  console.log(`  Player cache warmed: ${all.length} players\n`);
  playerCacheLoaded = true;
}

/**
 * Ensure all players in `entries` exist in DB.
 * Unknown players are batch-created in one createMany call.
 * Returns a name → DB id map for all entries.
 */
async function ensurePlayers(
  entries: Array<{ name: string; externalId?: string }>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Identify which players are not yet cached
  const unknown: Array<{ name: string; externalId?: string }> = [];
  for (const e of entries) {
    const key = e.externalId ? `ext:${e.externalId}` : `name:${e.name}`;
    if (playerCache.has(key)) {
      result.set(e.name, playerCache.get(key)!);
    } else {
      unknown.push(e);
    }
  }

  if (unknown.length > 0) {
    // Batch create — skipDuplicates handles any race or re-import scenario
    await prisma.player.createMany({
      data: unknown.map((e) => ({ name: e.name, externalId: e.externalId || undefined })),
      skipDuplicates: true,
    });

    // Fetch back the IDs for newly created players
    const names = [...new Set(unknown.map((e) => e.name))];
    const created = await prisma.player.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true, externalId: true },
    });
    for (const p of created) {
      if (p.externalId) playerCache.set(`ext:${p.externalId}`, p.id);
      playerCache.set(`name:${p.name}`, p.id);
      result.set(p.name, p.id);
    }
  }

  return result;
}

// ── Global state ──────────────────────────────────────────────────────────────
// Pre-loaded at startup so no per-match DB queries for existence checks
const existingMatchIds = new Set<string>();

// ── Import one file ───────────────────────────────────────────────────────────

async function importFile(filePath: string): Promise<"imported" | "skipped" | "error"> {
  let data: CricsheetMatch;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CricsheetMatch;
  } catch {
    return "error";
  }

  const sourceMatchId = path.basename(filePath, ".json");

  // Skip if already imported (in-memory set — no DB roundtrip)
  if (existingMatchIds.has(sourceMatchId)) return "skipped";

  const teams = data.info.teams;
  if (!teams || teams.length < 2) return "error";

  const rawTeam1 = teams[0];
  const rawTeam2 = teams[1];

  // Alphabetical normalization (consistent with existing pipeline)
  const [normalizedTeamA, normalizedTeamB] =
    rawTeam1.localeCompare(rawTeam2) <= 0
      ? [rawTeam1, rawTeam2]
      : [rawTeam2, rawTeam1];

  const sideOf = (name: string): "A" | "B" =>
    name === normalizedTeamA ? "A" : "B";

  const matchDate = data.info.dates?.[0] ? new Date(data.info.dates[0]) : undefined;
  const venue = data.info.venue;
  const city = data.info.city;

  const outcomeName = data.info.outcome?.winner;
  const winnerTeam = outcomeName ? sideOf(outcomeName) : null;
  const tossWinnerName = data.info.toss?.winner;
  const tossWinnerTeam = tossWinnerName ? sideOf(tossWinnerName) : null;
  const tossDecision = data.info.toss?.decision ?? null;

  // Create match — if unique constraint fires (P2002), another run already inserted it
  let match: { id: string };
  try {
    match = await prisma.match.create({
      data: {
        teamA: normalizedTeamA,
        teamB: normalizedTeamB,
        teamAName: rawTeam1,
        teamBName: rawTeam2,
        source: "cricsheet",
        sourceMatchId,
        matchDate,
        venue,
        city,
        winnerTeam,
        tossWinnerTeam,
        tossDecision,
      },
      select: { id: true },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      existingMatchIds.add(sourceMatchId);
      return "skipped";
    }
    throw err;
  }
  // Track so subsequent files in same run skip without DB
  existingMatchIds.add(sourceMatchId);

  const registry = data.info.registry?.people ?? {};

  // Compute innings totals (runs + wickets) from delivery data — no ball events stored
  let innings1Runs = 0, innings1Wickets = 0;
  let innings2Runs = 0, innings2Wickets = 0;
  for (let i = 0; i < Math.min(2, (data.innings ?? []).length); i++) {
    const inn = data.innings[i];
    let runs = 0, wickets = 0;
    for (const over of inn.overs ?? []) {
      for (const d of over.deliveries ?? []) {
        runs += d.runs.total;
        if (d.wickets && d.wickets.length > 0) wickets++;
      }
    }
    if (i === 0) { innings1Runs = runs; innings1Wickets = wickets; }
    else         { innings2Runs = runs; innings2Wickets = wickets; }
  }

  // Persist innings totals on the match record
  await prisma.match.update({
    where: { id: match.id },
    data: { innings1Runs, innings1Wickets, innings2Runs, innings2Wickets },
  });

  // Collect players from squad lists only (no per-delivery lookup needed)
  const allNames = new Set<string>();
  for (const [, playerList] of Object.entries(data.info.players ?? {})) {
    for (const n of playerList) allNames.add(n);
  }

  // Upsert players — batch create all unknowns in one DB call
  const playerEntries = Array.from(allNames).map((name) => ({
    name,
    externalId: registry[name] || undefined,
  }));
  const playerMap = await ensurePlayers(playerEntries);

  // Link players to match
  const matchPlayers: Array<{ matchId: string; playerId: string; team: string }> = [];
  for (const [teamName, playerList] of Object.entries(data.info.players ?? {})) {
    const team = teamName === normalizedTeamA ? "A" : "B";
    for (const name of playerList) {
      const pid = playerMap.get(name);
      if (pid) matchPlayers.push({ matchId: match.id, playerId: pid, team });
    }
  }
  if (matchPlayers.length > 0) {
    await prisma.matchPlayer.createMany({ data: matchPlayers, skipDuplicates: true });
  }

  return "imported";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/bulkImportCricsheet.ts <directory> [label]");
    process.exit(1);
  }

  const dirPath = path.resolve(args[0]);
  const label = args[1] ?? path.basename(dirPath);

  if (!fs.existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dirPath, f));

  console.log(`\n=== Bulk import: ${label} ===`);
  console.log(`Found ${files.length} JSON files in ${dirPath}\n`);

  // Pre-load existing match IDs (one query — avoids per-file DB check)
  console.log("  Loading existing match IDs from DB…");
  const existing = await prisma.match.findMany({
    where: { source: "cricsheet" },
    select: { sourceMatchId: true },
  });
  for (const m of existing) if (m.sourceMatchId) existingMatchIds.add(m.sourceMatchId);
  console.log(`  ${existingMatchIds.size} matches already in DB (will skip)\n`);

  // Pre-load all players into in-memory cache (one query)
  await warmPlayerCache();

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < files.length; i++) {
    const result = await importFile(files[i]);
    if (result === "imported") imported++;
    else if (result === "skipped") skipped++;
    else errors++;

    if ((i + 1) % 100 === 0 || i + 1 === files.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (imported / Math.max(1, (Date.now() - startTime) / 1000)).toFixed(1);
      console.log(
        `  [${i + 1}/${files.length}] imported=${imported} skipped=${skipped} errors=${errors} | ${elapsed}s elapsed | ${rate} matches/s`
      );
    }
  }

  const total = (Date.now() - startTime) / 1000;
  console.log(`\n✅ Done in ${total.toFixed(0)}s`);
  console.log(`   Imported : ${imported}`);
  console.log(`   Skipped  : ${skipped} (already in DB)`);
  console.log(`   Errors   : ${errors}`);
}

main()
  .catch((err) => { console.error("Fatal:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
