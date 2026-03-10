/**
 * Polymarket API client.
 * Gamma API  (markets/search/discovery): https://gamma-api.polymarket.com
 * Data API   (trades, activity, OI):     https://data-api.polymarket.com
 * CLOB API   (live orderbook):           https://clob.polymarket.com
 *
 * All read endpoints are public — no API key required.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const DATA_BASE = "https://data-api.polymarket.com";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PolymarketMarket {
  id: string;          // numeric Gamma id
  conditionId: string; // 0x hex condition id (used for Data/CLOB APIs)
  slug: string;
  question: string;
  description?: string;
  active: boolean;
  closed: boolean;
  endDate?: string;
  tokens: PolymarketToken[];
  volume?: number;       // lifetime USD volume
  volume24hr?: number;
  volume1wk?: number;
  liquidity?: number;
}

export interface PolymarketToken {
  tokenId: string;
  outcome: string;   // "Yes"/"No" or team name
  price?: number;    // last trade price (implied prob 0–1)
}

export interface PolymarketOdds {
  marketId: string;
  question: string;
  tokens: Array<{
    tokenId: string;
    outcome: string;
    bestBid: number;
    bestAsk: number;
    impliedProb: number; // mid-price
  }>;
  observedAt: string;
}

export interface PolymarketTrade {
  side: "BUY" | "SELL";
  outcome: string;
  size: number;       // USD
  price: number;      // 0–1
  timestamp: number;  // Unix seconds
}

export interface PolymarketMarketActivity {
  conditionId: string;
  recentTrades: PolymarketTrade[];   // last N trades
  totalRecentVolume: number;          // USD sum of recent trades
  netBuyPressure: number;             // +1 all buys, -1 all sells (–1 to +1)
  // Per-outcome buy pressure (0–1 scale)
  outcomeBuyPressure: Record<string, number>;
}

// ── Gamma API ─────────────────────────────────────────────────────────────────

/**
 * Search Polymarket for cricket-related markets using the Gamma API.
 * Returns active markets with volume + liquidity metadata.
 */
export async function searchCricketMarkets(query: string = "cricket"): Promise<PolymarketMarket[]> {
  const url = new URL(`${GAMMA_BASE}/markets`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    throw new Error(`Gamma API error ${res.status}: ${await res.text()}`);
  }

  const raw: any[] = await res.json();
  const lowerQuery = query.toLowerCase();

  const filtered = raw.filter((m) => {
    const text = `${m.question ?? ""} ${m.description ?? ""}`.toLowerCase();
    return (
      text.includes(lowerQuery) ||
      text.includes("ipl") ||
      text.includes("cricket") ||
      text.includes("t20") ||
      text.includes("test match") ||
      text.includes("wpl") ||
      text.includes("bcci")
    );
  });

  return filtered.map((m) => {
    const tokenIds: string[] = JSON.parse(m.clobTokenIds ?? "[]");
    const outcomes: string[] = JSON.parse(m.outcomes ?? '["Yes","No"]');
    const prices: string[] = JSON.parse(m.outcomePrices ?? '["0.5","0.5"]');

    return {
      id: String(m.id),
      conditionId: m.conditionId ?? "",
      slug: m.slug ?? "",
      question: m.question ?? "",
      description: m.description,
      active: m.active ?? true,
      closed: m.closed ?? false,
      endDate: m.endDate,
      tokens: tokenIds.map((tokenId, i) => ({
        tokenId,
        outcome: outcomes[i] ?? `Token ${i}`,
        price: parseFloat(prices[i] ?? "0.5"),
      })),
      volume: m.volumeNum ?? m.volume ?? 0,
      volume24hr: m.volume24hr ?? 0,
      volume1wk: m.volume1wk ?? 0,
      liquidity: m.liquidityNum ?? m.liquidity ?? 0,
    };
  });
}

// ── CLOB API ──────────────────────────────────────────────────────────────────

/**
 * Get live orderbook mid-prices for all tokens in a market.
 */
export async function getMarketOdds(market: PolymarketMarket): Promise<PolymarketOdds> {
  const tickResults = await Promise.all(
    market.tokens.map(async (token) => {
      try {
        const res = await fetch(`${CLOB_BASE}/book?token_id=${token.tokenId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const book = await res.json();
        const bestBid: number = book.bids?.[0]?.price ?? 0;
        const bestAsk: number = book.asks?.[0]?.price ?? 1;
        return { tokenId: token.tokenId, bestBid, bestAsk };
      } catch {
        return null;
      }
    })
  );

  const tokens = market.tokens.map((token, i) => {
    const tick = tickResults[i];
    const bestBid = tick?.bestBid ?? token.price ?? 0;
    const bestAsk = tick?.bestAsk ?? token.price ?? 1;
    return {
      tokenId: token.tokenId,
      outcome: token.outcome,
      bestBid,
      bestAsk,
      impliedProb: (bestBid + bestAsk) / 2,
    };
  });

  return {
    marketId: market.id,
    question: market.question,
    tokens,
    observedAt: new Date().toISOString(),
  };
}

// ── Data API ──────────────────────────────────────────────────────────────────

/**
 * Fetch recent trades for a market from the Data API.
 * Returns trade flow summary — net buy pressure and per-outcome breakdown.
 */
export async function getMarketActivity(
  conditionId: string,
  limit = 50
): Promise<PolymarketMarketActivity> {
  const url = new URL(`${DATA_BASE}/trades`);
  url.searchParams.set("market", conditionId);
  url.searchParams.set("limit", String(limit));

  let trades: PolymarketTrade[] = [];

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const raw: any[] = await res.json();
      // Filter to trades that actually match this conditionId
      trades = raw
        .filter((t) => t.conditionId === conditionId)
        .map((t) => ({
          side: t.side as "BUY" | "SELL",
          outcome: t.outcome ?? "Unknown",
          size: Number(t.size ?? 0),
          price: Number(t.price ?? 0.5),
          timestamp: Number(t.timestamp ?? 0),
        }));
    }
  } catch {
    // Non-fatal — return empty activity
  }

  const totalRecentVolume = trades.reduce((s, t) => s + t.size, 0);

  // Net buy pressure: (buyVol - sellVol) / totalVol  →  range –1 to +1
  const buyVol = trades.filter((t) => t.side === "BUY").reduce((s, t) => s + t.size, 0);
  const sellVol = totalRecentVolume - buyVol;
  const netBuyPressure =
    totalRecentVolume > 0 ? (buyVol - sellVol) / totalRecentVolume : 0;

  // Per-outcome: what fraction of buys went to each outcome
  const outcomeBuyVol: Record<string, number> = {};
  for (const t of trades) {
    if (t.side === "BUY") {
      outcomeBuyVol[t.outcome] = (outcomeBuyVol[t.outcome] ?? 0) + t.size;
    }
  }
  const totalBuyVol = buyVol || 1;
  const outcomeBuyPressure: Record<string, number> = {};
  for (const [outcome, vol] of Object.entries(outcomeBuyVol)) {
    outcomeBuyPressure[outcome] = vol / totalBuyVol;
  }

  return { conditionId, recentTrades: trades, totalRecentVolume, netBuyPressure, outcomeBuyPressure };
}

// ── Combined ──────────────────────────────────────────────────────────────────

/**
 * Search cricket markets, fetch live CLOB odds + Data API activity for each.
 */
export async function searchCricketMarketsWithOdds(
  query: string = "cricket"
): Promise<Array<{ market: PolymarketMarket; odds: PolymarketOdds | null }>> {
  const markets = await searchCricketMarkets(query);

  return Promise.all(
    markets.slice(0, 20).map(async (market) => {
      try {
        const odds = await getMarketOdds(market);
        return { market, odds };
      } catch {
        return { market, odds: null };
      }
    })
  );
}

/**
 * Full enrichment: Gamma metadata + CLOB live odds + Data API trade flow.
 * Used by the edge signals dashboard Polymarket panel.
 */
export async function searchCricketMarketsEnriched(query: string = "cricket"): Promise<Array<{
  market: PolymarketMarket;
  odds: PolymarketOdds | null;
  activity: PolymarketMarketActivity | null;
}>> {
  const markets = await searchCricketMarkets(query);
  const subset = markets.slice(0, 15);

  return Promise.all(
    subset.map(async (market) => {
      const [odds, activity] = await Promise.allSettled([
        getMarketOdds(market),
        market.conditionId ? getMarketActivity(market.conditionId) : Promise.resolve(null),
      ]);
      return {
        market,
        odds: odds.status === "fulfilled" ? odds.value : null,
        activity: activity.status === "fulfilled" ? activity.value : null,
      };
    })
  );
}
