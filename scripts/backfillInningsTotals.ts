/**
 * Backfill innings1Runs / innings2Runs / innings1Wickets / innings2Wickets
 * for matches already in DB that have NULL innings totals.
 *
 * Reads the original Cricsheet JSON files from two directories,
 * computes totals, and batch-updates the DB.
 *
 * Usage:
 *   npx tsx scripts/backfillInningsTotals.ts <ipl_dir> <t20i_dir>
 *   npx tsx scripts/backfillInningsTotals.ts ../ipl_json ../t20s_json
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Delivery {
  runs: { batter: number; extras: number; total: number };
  wickets?: unknown[];
}
interface Over { deliveries: Delivery[] }
interface Innings { overs?: Over[] }
interface CricsheetMatch { innings?: Innings[] }

function computeTotals(data: CricsheetMatch) {
  const innings = data.innings ?? [];
  let innings1Runs = 0, innings1Wickets = 0;
  let innings2Runs = 0, innings2Wickets = 0;
  for (let i = 0; i < Math.min(2, innings.length); i++) {
    let runs = 0, wickets = 0;
    for (const over of innings[i].overs ?? []) {
      for (const d of over.deliveries ?? []) {
        runs += d.runs.total;
        if (d.wickets && d.wickets.length > 0) wickets++;
      }
    }
    if (i === 0) { innings1Runs = runs; innings1Wickets = wickets; }
    else         { innings2Runs = runs; innings2Wickets = wickets; }
  }
  return { innings1Runs, innings1Wickets, innings2Runs, innings2Wickets };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: npx tsx scripts/backfillInningsTotals.ts <ipl_dir> <t20i_dir>");
    process.exit(1);
  }

  const dirs = args.slice(0, 2).map((d) => path.resolve(d));

  // Load all matches that need backfill
  const matches = await prisma.match.findMany({
    where: { source: "cricsheet", innings1Runs: null },
    select: { id: true, sourceMatchId: true },
  });
  console.log(`Found ${matches.length} matches needing backfill`);

  const matchMap = new Map(matches.map((m) => [m.sourceMatchId, m.id]));
  let updated = 0, missing = 0, errors = 0;

  // Scan both directories
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) { console.warn(`Dir not found: ${dir}`); continue; }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const sourceMatchId = path.basename(file, ".json");
      const matchId = matchMap.get(sourceMatchId);
      if (!matchId) continue; // already up to date or not in DB

      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as CricsheetMatch;
        const totals = computeTotals(data);
        await prisma.match.update({ where: { id: matchId }, data: totals });
        matchMap.delete(sourceMatchId); // mark done
        updated++;
        if (updated % 500 === 0) console.log(`  Updated ${updated}…`);
      } catch {
        errors++;
      }
    }
  }

  missing = matchMap.size;
  console.log(`\nDone. Updated: ${updated}  Missing JSON: ${missing}  Errors: ${errors}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
