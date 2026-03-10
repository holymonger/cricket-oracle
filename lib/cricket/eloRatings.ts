/**
 * T20 Elo rating engine.
 *
 * Processes all Cricsheet-imported matches in chronological order to build
 * running Elo ratings for every team. Works across both IPL and international
 * T20s — teams naturally form separate clusters since they never play each other.
 *
 * Formula:
 *   P(A wins) = 1 / (1 + 10^((eloB - eloA) / 400))
 *   newElo    = oldElo + K * (outcome - P)
 *     K = 40 for first 20 matches (volatile), 24 thereafter (stable)
 *
 * Results cached in memory for 10 minutes — recomputed on first request after restart.
 */

import { prisma } from "@/lib/db/prisma";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_ELO   = 1500;
const K_INITIAL     = 40;   // higher K-factor for first 20 matches
const K_ESTABLISHED = 24;   // stable K once team has history
const INITIAL_THRESHOLD = 20;
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 minutes

// ── Team name canonical mapping ────────────────────────────────────────────────
// Maps historical / alternate names → current canonical name.
// All matches still count toward Elo (history is preserved) but under one name.

const TEAM_NAME_MAP: Record<string, string> = {
  // IPL renames
  "Royal Challengers Bangalore":  "Royal Challengers Bengaluru",
  "Delhi Daredevils":             "Delhi Capitals",
  "Kings XI Punjab":              "Punjab Kings",
  "Rising Pune Supergiant":       "Rising Pune Supergiants", // normalise spelling
  // Common abbreviations/aliases that occasionally appear in Cricsheet
  "RCB":  "Royal Challengers Bengaluru",
  "CSK":  "Chennai Super Kings",
  "MI":   "Mumbai Indians",
  "KKR":  "Kolkata Knight Riders",
  "DC":   "Delhi Capitals",
  "RR":   "Rajasthan Royals",
  "SRH":  "Sunrisers Hyderabad",
  "PBKS": "Punjab Kings",
  "GT":   "Gujarat Titans",
  "LSG":  "Lucknow Super Giants",
};

function canonicalName(name: string): string {
  return TEAM_NAME_MAP[name] ?? name;
}

// ── Defunct IPL franchises ─────────────────────────────────────────────────────
// These teams are INCLUDED in Elo computation (their matches shaped other teams'
// ratings) but are EXCLUDED from rankings output.

export const DEFUNCT_IPL_TEAMS = new Set([
  "Deccan Chargers",
  "Kochi Tuskers Kerala",
  "Pune Warriors",
  "Pune Warriors India",
  "Rising Pune Supergiants", // canonical of both spellings
]);

// ── Active IPL 2026 franchises ─────────────────────────────────────────────────

export const ACTIVE_IPL_TEAMS = new Set([
  "Chennai Super Kings",
  "Royal Challengers Bengaluru",
  "Gujarat Titans",
  "Punjab Kings",
  "Sunrisers Hyderabad",
  "Mumbai Indians",
  "Rajasthan Royals",
  "Kolkata Knight Riders",
  "Lucknow Super Giants",
  "Delhi Capitals",
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TeamEloRating {
  team: string;
  elo: number;
  matchCount: number;
  wins: number;
  losses: number;
  winPct: number;
}

export interface EloWinProbResult {
  teamAWinProb: number;   // 0–1
  teamBWinProb: number;
  teamAElo: number;
  teamBElo: number;
  teamAMatchCount: number;
  teamBMatchCount: number;
  teamAFound: string;     // canonical name as found in DB
  teamBFound: string;
  confidence: "high" | "medium" | "low";
}

// ── In-memory cache ────────────────────────────────────────────────────────────

let _cache: Map<string, TeamEloRating> | null = null;
let _cacheTime = 0;

// ── Core computation ───────────────────────────────────────────────────────────

function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * Computes Elo ratings for all teams from scratch by replaying all
 * Cricsheet-imported matches in date order.
 */
export async function computeEloRatings(): Promise<Map<string, TeamEloRating>> {
  const matches = await prisma.match.findMany({
    where: {
      source: "cricsheet",
      winnerTeam: { not: null },
      matchDate:  { not: null },
    },
    select: {
      teamA: true,
      teamB: true,
      winnerTeam: true,
      matchDate: true,
    },
    orderBy: { matchDate: "asc" },
  });

  const ratings = new Map<string, TeamEloRating>();

  function get(name: string): TeamEloRating {
    if (!ratings.has(name)) {
      ratings.set(name, { team: name, elo: DEFAULT_ELO, matchCount: 0, wins: 0, losses: 0, winPct: 0 });
    }
    return ratings.get(name)!;
  }

  for (const m of matches) {
    // Apply canonical names so renamed teams accumulate Elo under one key
    const nameA = canonicalName(m.teamA);
    const nameB = canonicalName(m.teamB);
    const rA = get(nameA);
    const rB = get(nameB);

    const pA = expectedScore(rA.elo, rB.elo);
    const actualA = m.winnerTeam === "A" ? 1 : 0;

    const kA = rA.matchCount < INITIAL_THRESHOLD ? K_INITIAL : K_ESTABLISHED;
    const kB = rB.matchCount < INITIAL_THRESHOLD ? K_INITIAL : K_ESTABLISHED;

    rA.elo += kA * (actualA - pA);
    rB.elo += kB * ((1 - actualA) - (1 - pA));

    rA.matchCount++; rA.wins += actualA;       rA.losses += 1 - actualA;
    rB.matchCount++; rB.wins += 1 - actualA;   rB.losses += actualA;

    rA.winPct = rA.matchCount > 0 ? rA.wins / rA.matchCount : 0;
    rB.winPct = rB.matchCount > 0 ? rB.wins / rB.matchCount : 0;

    ratings.set(nameA, rA);
    ratings.set(nameB, rB);
  }

  return ratings;
}

/** Returns cached ratings, recomputing if stale. */
export async function getEloRatings(): Promise<Map<string, TeamEloRating>> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) return _cache;
  _cache = await computeEloRatings();
  _cacheTime = Date.now();
  return _cache;
}

/** Invalidate cache (e.g. after new matches are imported). */
export function invalidateEloCache(): void {
  _cache = null;
  _cacheTime = 0;
}

// ── Team name fuzzy matching ───────────────────────────────────────────────────

/**
 * Finds a team's Elo rating by name, with fuzzy fallback.
 * CricAPI names (e.g. "New Zealand") need to map to Cricsheet names (e.g. "New Zealand").
 * Handles short names, case differences, and word overlaps.
 */
function findTeam(name: string, ratings: Map<string, TeamEloRating>): TeamEloRating | null {
  // 0. Apply canonical name first (handles RCB, Delhi Daredevils, etc.)
  const canonical = canonicalName(name);

  // 1. Exact match (canonical)
  if (ratings.has(canonical)) return ratings.get(canonical)!;
  if (ratings.has(name)) return ratings.get(name)!;

  const lower = name.toLowerCase().trim();

  // 2. Case-insensitive exact
  for (const [key, val] of ratings) {
    if (key.toLowerCase() === lower) return val;
  }

  // 3. Significant word overlap (words > 3 chars)
  const words = lower.split(/[\s_\-]+/).filter((w) => w.length > 3);
  let bestMatch: TeamEloRating | null = null;
  let bestScore = 0;

  for (const [key, val] of ratings) {
    const kl = key.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (kl.includes(w)) score += w.length; // longer word match = stronger signal
    }
    if (score > bestScore) { bestScore = score; bestMatch = val; }
  }

  // Require at least one word of length 4+ to match
  return bestScore >= 4 ? bestMatch : null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get Elo-based win probability for two teams by name.
 * Returns null if either team cannot be found in the Elo ratings.
 */
export async function getEloWinProb(
  teamAName: string,
  teamBName: string
): Promise<EloWinProbResult | null> {
  const ratings = await getEloRatings();

  const rA = findTeam(teamAName, ratings);
  const rB = findTeam(teamBName, ratings);

  if (!rA || !rB) return null;

  const teamAWinProb = expectedScore(rA.elo, rB.elo);

  // Confidence: high if both teams have 20+ matches, low if either has < 10
  const minMatches = Math.min(rA.matchCount, rB.matchCount);
  const confidence: "high" | "medium" | "low" =
    minMatches >= 20 ? "high" : minMatches >= 10 ? "medium" : "low";

  return {
    teamAWinProb: Math.round(teamAWinProb * 10000) / 10000,
    teamBWinProb: Math.round((1 - teamAWinProb) * 10000) / 10000,
    teamAElo: Math.round(rA.elo),
    teamBElo: Math.round(rB.elo),
    teamAMatchCount: rA.matchCount,
    teamBMatchCount: rB.matchCount,
    teamAFound: rA.team,
    teamBFound: rB.team,
    confidence,
  };
}

/**
 * Top N teams by Elo.
 * @param limit       Max teams to return
 * @param minMatches  Minimum match count to include
 * @param excludeDefunct  Hide defunct IPL franchises from output (default true)
 */
export async function getTopTeams(
  limit = 20,
  minMatches = 10,
  excludeDefunct = true
): Promise<TeamEloRating[]> {
  const ratings = await getEloRatings();
  return [...ratings.values()]
    .filter((r) => r.matchCount >= minMatches)
    .filter((r) => !excludeDefunct || !DEFUNCT_IPL_TEAMS.has(r.team))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, limit);
}
