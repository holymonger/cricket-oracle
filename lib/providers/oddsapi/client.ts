/**
 * odds-api.io client — Rollbit cricket odds
 * Docs: https://docs.odds-api.io
 *
 * Account is locked to bookmakers: Rollbit, Polymarket.
 * We use this ONLY for Rollbit. Polymarket uses its own dedicated client.
 */

const BASE = "https://api.odds-api.io/v3";
const API_KEY = process.env.ODDS_API_KEY ?? "";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OddsApiEvent {
  id: number;
  home: string;
  away: string;
  date: string;           // ISO 8601
  status: "pending" | "live" | "settled" | "cancelled" | string;
  sport: { name: string; slug: string };
  league: { name: string; slug: string };
  scores: { home: number; away: number };
}

/** Market odds from a single bookmaker, keyed by market type (ML, etc.) */
export interface BookmakerMarket {
  /** Match result odds: home / away / draw */
  ML?: { home: number | null; away: number | null; draw?: number | null };
  /** Other markets if present */
  [market: string]: unknown;
}

export interface OddsApiOddsResponse {
  id: number;
  home: string;
  away: string;
  date: string;
  status: string;
  sport: { name: string; slug: string };
  league: { name: string; slug: string };
  /** bookmakers[bookmakerName][marketType] = odds */
  bookmakers: Record<string, BookmakerMarket>;
}

/** A single cricket event with Rollbit ML odds attached (null when no market) */
export interface RollbitCricketEvent {
  eventId: number;
  home: string;
  away: string;
  date: string;
  status: string;
  league: string;
  /** Rollbit decimal odds for home win (null = no market) */
  homeOdds: number | null;
  /** Rollbit decimal odds for away win */
  awayOdds: number | null;
  /** Implied probability of home win (vig-inclusive) */
  homeImplied: number | null;
  /** Implied probability of away win (vig-inclusive) */
  awayImplied: number | null;
  /** Fair home probability (vig removed) */
  homeFair: number | null;
  /** Fair away probability (vig removed) */
  awayFair: number | null;
  /** Bookmaker overround (total vig, e.g. 1.05 = 5% margin) */
  overround: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function impliedProb(decimal: number): number {
  return 1 / decimal;
}

function fairProbs(homeOdds: number, awayOdds: number) {
  const rawHome = impliedProb(homeOdds);
  const rawAway = impliedProb(awayOdds);
  const overround = rawHome + rawAway;
  return {
    homeFair: rawHome / overround,
    awayFair: rawAway / overround,
    homeImplied: rawHome,
    awayImplied: rawAway,
    overround,
  };
}

async function apiFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ apiKey: API_KEY, ...params }).toString();
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`odds-api.io ${path} ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetch all upcoming + live cricket events, then batch-fetch Rollbit ML odds.
 * Events where Rollbit has no market are included with null odds so the UI
 * can display them as "no market" rather than silently dropping them.
 *
 * @param limitEvents  Maximum number of events to fetch odds for (default 20)
 */
export async function getRollbitCricketEvents(limitEvents = 20): Promise<RollbitCricketEvent[]> {
  if (!API_KEY) throw new Error("ODDS_API_KEY not set");

  // 1. Fetch upcoming + live events
  const events = await apiFetch<OddsApiEvent[]>("/events", {
    sport: "cricket",
    status: "pending",
    limit: String(limitEvents),
  });

  // 2. Parallel-fetch Rollbit odds for each event (cap at limitEvents)
  const targets = events.slice(0, limitEvents);

  const oddsResults = await Promise.allSettled(
    targets.map((ev) =>
      apiFetch<OddsApiOddsResponse>("/odds", {
        eventId: String(ev.id),
        bookmakers: "Rollbit",
      })
    )
  );

  // 3. Merge
  return targets.map((ev, i) => {
    const result = oddsResults[i];
    const oddsData = result.status === "fulfilled" ? result.value : null;
    const rollbit = oddsData?.bookmakers?.["Rollbit"];
    const ml = rollbit?.ML;

    const homeOdds = ml?.home ?? null;
    const awayOdds = ml?.away ?? null;

    let probs: ReturnType<typeof fairProbs> | null = null;
    if (homeOdds && awayOdds && homeOdds > 1 && awayOdds > 1) {
      probs = fairProbs(homeOdds, awayOdds);
    }

    return {
      eventId: ev.id,
      home: ev.home,
      away: ev.away,
      date: ev.date,
      status: ev.status,
      league: ev.league.name,
      homeOdds,
      awayOdds,
      homeImplied: probs?.homeImplied ?? null,
      awayImplied: probs?.awayImplied ?? null,
      homeFair: probs?.homeFair ?? null,
      awayFair: probs?.awayFair ?? null,
      overround: probs?.overround ?? null,
    };
  });
}

/**
 * Fetch only events where Rollbit actively has ML odds.
 */
export async function getRollbitActiveCricketMarkets(): Promise<RollbitCricketEvent[]> {
  const all = await getRollbitCricketEvents(50);
  return all.filter((e) => e.homeOdds !== null && e.awayOdds !== null);
}
