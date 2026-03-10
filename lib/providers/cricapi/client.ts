/**
 * CricAPI client — live match scores and scorecards
 * Base URL: https://api.cricapi.com/v1
 * Auth: ?apikey=KEY (paid tier)
 *
 * Cache strategy:
 *   currentMatches  → 5min TTL (≈ 12 hits/hour, 3 pages × 4 = 12 API hits)
 *   match_scorecard → 45s TTL  (≈ 80 hits/hour for 1 live match)
 *   match_info      → 45s TTL (live), 10min (ended)
 *
 * Browser auto-refreshes every 45s — cache and browser interval are aligned,
 * so each browser poll triggers exactly 1 CricAPI hit (when cache expires).
 * Force-refresh (bust cache) available via invalidateCache().
 */

const BASE = "https://api.cricapi.com/v1";
const KEY = process.env.CRICAPI_KEY ?? "";

// Paid tier — 20s TTL gives ~180 hits/hour per live match.
const TTL = {
  matchList: 5 * 60 * 1000,          // 5 minutes — upcoming matches need fresher list
  scorecardLive: 20 * 1000,          // 20 seconds — matches browser poll interval
  scorecardEnded: 10 * 60 * 1000,    // 10 minutes — no point polling finished matches
  infoLive: 20 * 1000,               // 20 seconds
  infoEnded: 10 * 60 * 1000,         // 10 minutes
} as const;

// ── TTL Cache ─────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number; fetchedAt: number }
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  cache.delete(key);
  return null;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs, fetchedAt: Date.now() });
}

/** Invalidate a specific cache key so the next request forces a fresh API hit. */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/** Invalidate all cached entries. */
export function invalidateAllCache(): void {
  cache.clear();
}

/** Return cache metadata — useful for the UI to show "fetched Xs ago". */
export function getCacheInfo(key: string): { fetchedAt: number; expiresAt: number } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  return { fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt };
}

// ── Raw API Types ─────────────────────────────────────────────────────────────

export interface CricApiScore {
  r: number;   // runs
  w: number;   // wickets
  o: number;   // overs (e.g. 14.3)
  inning: string;  // "India Inning 1"
}

export interface CricApiTeamInfo {
  name: string;
  shortname: string;
  img: string;
}

export interface CricApiBatsman {
  batsman: { id: string; name: string };
  dismissal: string;
  bowler?: { id: string; name: string };
  "dismissal-text": string;
  r: number;
  b: number;
  "4s": number;
  "6s": number;
  sr: number;
}

export interface CricApiBowler {
  bowler: { id: string; name: string };
  o: number;
  r: number;
  w: number;
  eco: number;
  nb?: number;
  wd?: number;
}

export interface CricApiInningsCard {
  batting: CricApiBatsman[];
  bowling: CricApiBowler[];
  extras?: { r: number; b?: number; lb?: number; wd?: number; nb?: number; p?: number };
  powerplay?: { o: number; r: number; w: number };
}

export interface CricApiMatch {
  id: string;
  name: string;
  matchType: "t20" | "odi" | "test" | string;
  status: string;
  venue: string;
  date: string;
  dateTimeGMT: string;
  teams: [string, string];
  teamInfo: CricApiTeamInfo[];
  score: CricApiScore[];
  tossWinner?: string;
  tossChoice?: string;
  matchWinner?: string;
  series_id?: string;
  fantasyEnabled: boolean;
  bbbEnabled: boolean;
  hasSquad: boolean;
  matchStarted: boolean;
  matchEnded: boolean;
  scorecard?: CricApiInningsCard[];
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  if (!KEY) throw new Error("CRICAPI_KEY not set");
  const qs = new URLSearchParams({ apikey: KEY, ...params }).toString();
  const res = await fetch(`${BASE}/${endpoint}?${qs}`);
  if (!res.ok) throw new Error(`CricAPI ${endpoint} ${res.status}`);
  const json = await res.json();
  if (json.status === "failure") throw new Error(`CricAPI: ${json.reason}`);
  return json.data as T;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const CACHE_KEY_MATCHES = "currentMatches";

/**
 * All current matches (live + upcoming + recently finished).
 * Fetches up to 3 pages (75 matches) to catch upcoming fixtures beyond page 1.
 * Cached 24 hours — call invalidateCache(CACHE_KEY_MATCHES) to force a refresh.
 */
export async function getCurrentMatches(force = false): Promise<CricApiMatch[]> {
  if (force) invalidateCache(CACHE_KEY_MATCHES);
  const cached = getCached<CricApiMatch[]>(CACHE_KEY_MATCHES);
  if (cached) return cached;

  // Fetch page 1 first; only fetch more pages if it's full (25 results = more exist)
  const page1 = await apiFetch<CricApiMatch[]>("currentMatches", { offset: "0" }).catch(() => [] as CricApiMatch[]);
  const data: CricApiMatch[] = [...page1];

  if (page1.length >= 25) {
    const page2 = await apiFetch<CricApiMatch[]>("currentMatches", { offset: "25" }).catch(() => [] as CricApiMatch[]);
    const seen = new Set(page1.map((m) => m.id));
    for (const m of page2) { if (!seen.has(m.id)) { seen.add(m.id); data.push(m); } }

    if (page2.length >= 25) {
      const page3 = await apiFetch<CricApiMatch[]>("currentMatches", { offset: "50" }).catch(() => [] as CricApiMatch[]);
      const seen2 = new Set(data.map((m) => m.id));
      for (const m of page3) { if (!seen2.has(m.id)) data.push(m); }
    }
  }

  setCached(CACHE_KEY_MATCHES, data, TTL.matchList);
  return data;
}

/** Only live T20 matches. */
export async function getLiveT20Matches(force = false): Promise<CricApiMatch[]> {
  const all = await getCurrentMatches(force);
  return all.filter((m) => m.matchType === "t20" && m.matchStarted && !m.matchEnded);
}

/** All live matches regardless of format. */
export async function getLiveMatches(force = false): Promise<CricApiMatch[]> {
  const all = await getCurrentMatches(force);
  return all.filter((m) => m.matchStarted && !m.matchEnded);
}

/**
 * Full scorecard for a match.
 * Live: 20s server cache — browser polling every 20s = ~180 API hits/hour.
 * Ended: 10-minute cache.
 * Pass force=true to bust cache and force a fresh CricAPI hit.
 */
export async function getMatchScorecard(matchId: string, force = false): Promise<CricApiMatch> {
  const cacheKey = `scorecard:${matchId}`;
  if (force) invalidateCache(cacheKey);
  const cached = getCached<CricApiMatch>(cacheKey);
  if (cached) return cached;

  const data = await apiFetch<CricApiMatch>("match_scorecard", { id: matchId });
  const ttl = data.matchEnded ? TTL.scorecardEnded : TTL.scorecardLive;
  setCached(cacheKey, data, ttl);
  return data;
}

/** Match metadata without full scorecard. Cached 2 min (live) / 10 min (ended). */
export async function getMatchInfo(matchId: string, force = false): Promise<CricApiMatch> {
  const cacheKey = `info:${matchId}`;
  if (force) invalidateCache(cacheKey);
  const cached = getCached<CricApiMatch>(cacheKey);
  if (cached) return cached;

  const data = await apiFetch<CricApiMatch>("match_info", { id: matchId });
  const ttl = data.matchEnded ? TTL.infoEnded : TTL.infoLive;
  setCached(cacheKey, data, ttl);
  return data;
}

// ── State Extraction ──────────────────────────────────────────────────────────

export interface LiveMatchState {
  matchId: string;
  name: string;
  matchType: string;
  status: string;
  venue: string;
  teams: [string, string];
  /** Index into teams[] for batting team in current innings (0 or 1) */
  battingTeamIdx: number | null;
  /** Current innings number (1 or 2) */
  innings: number;
  /** Runs scored by batting team this innings */
  runs: number;
  /** Wickets lost this innings */
  wickets: number;
  /** Total balls bowled this innings */
  balls: number;
  /** Current run rate */
  runRate: number;
  /** Target (innings 2 only) */
  target: number | null;
  /** Required run rate (innings 2 only) */
  requiredRunRate: number | null;
  /** Runs needed (innings 2 only) */
  runsNeeded: number | null;
  /** Balls remaining (innings 2 only) */
  ballsRemaining: number | null;
  /** Toss info */
  tossWinner: string | undefined;
  tossChoice: string | undefined;
  /** Score summary per innings */
  scorecard: Array<{ inning: string; r: number; w: number; o: number }>;
  matchStarted: boolean;
  matchEnded: boolean;
  matchWinner: string | undefined;
}

function oversToDecimal(o: number): number {
  // 14.3 → 14 full overs + 3 balls = 87 balls
  const fullOvers = Math.floor(o);
  const balls = Math.round((o - fullOvers) * 10);
  return fullOvers * 6 + balls;
}

/**
 * Extracts the current live match state from a CricAPI match object.
 * Works for both innings 1 (setting) and innings 2 (chasing).
 */
export function extractLiveState(match: CricApiMatch): LiveMatchState {
  const scores = match.score ?? [];
  const teamA = match.teams[0];
  const teamB = match.teams[1];

  // Find the active (current) innings — last score entry that isn't all-out yet
  // or the most recent one if all are complete
  let activeScore = scores[scores.length - 1] ?? null;
  const innings = scores.length; // 1 or 2 active

  const runs = activeScore?.r ?? 0;
  const wickets = activeScore?.w ?? 0;
  const balls = activeScore ? oversToDecimal(activeScore.o) : 0;
  const runRate = balls > 0 ? (runs * 6) / balls : 0;

  // Innings 1 score
  const inn1Score = scores[0] ?? null;
  const target = innings >= 2 && inn1Score ? inn1Score.r + 1 : null;
  const maxBalls = match.matchType === "t20" ? 120 : match.matchType === "odi" ? 300 : null;
  const ballsRemaining = maxBalls !== null && innings >= 2 ? Math.max(0, maxBalls - balls) : null;
  const runsNeeded = target !== null ? Math.max(0, target - runs) : null;
  const requiredRunRate =
    runsNeeded !== null && ballsRemaining !== null && ballsRemaining > 0
      ? (runsNeeded * 6) / ballsRemaining
      : null;

  // Determine which team is batting in current innings
  // Innings 1 batting team is the one NOT named as toss winner who chose to bat,
  // but more reliably we can parse it from the inning string e.g. "India Inning 1"
  let battingTeamIdx: number | null = null;
  if (activeScore) {
    const inningStr = activeScore.inning.toLowerCase();
    if (inningStr.includes(teamA.toLowerCase())) battingTeamIdx = 0;
    else if (inningStr.includes(teamB.toLowerCase())) battingTeamIdx = 1;
    else {
      // Fallback: innings 1 = toss winner choice, innings 2 = other team
      if (innings === 1 && match.tossChoice === "bat") {
        battingTeamIdx = match.tossWinner?.toLowerCase() === teamA.toLowerCase() ? 0 : 1;
      } else if (innings === 1 && match.tossChoice === "field") {
        battingTeamIdx = match.tossWinner?.toLowerCase() === teamA.toLowerCase() ? 1 : 0;
      }
    }
  }

  return {
    matchId: match.id,
    name: match.name,
    matchType: match.matchType,
    status: match.status,
    venue: match.venue,
    teams: [teamA, teamB],
    battingTeamIdx,
    innings,
    runs,
    wickets,
    balls,
    runRate: Math.round(runRate * 100) / 100,
    target,
    requiredRunRate: requiredRunRate !== null ? Math.round(requiredRunRate * 100) / 100 : null,
    runsNeeded,
    ballsRemaining,
    tossWinner: match.tossWinner,
    tossChoice: match.tossChoice,
    scorecard: scores.map((s) => ({ inning: s.inning, r: s.r, w: s.w, o: s.o })),
    matchStarted: match.matchStarted,
    matchEnded: match.matchEnded,
    matchWinner: match.matchWinner,
  };
}
