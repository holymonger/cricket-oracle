/**
 * GET /api/polymarket/search?q=cricket
 * Proxy to Polymarket public API — searches active cricket markets and returns
 * live implied probabilities from the CLOB orderbook.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchCricketMarketsWithOdds } from "@/lib/providers/polymarket/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "cricket";

  try {
    const results = await searchCricketMarketsWithOdds(query);

    const payload = results.map(({ market, odds }) => ({
      id: market.id,
      slug: market.slug,
      question: market.question,
      active: market.active,
      volume: market.volume,
      liquidity: market.liquidity,
      endDate: market.endDate,
      tokens: odds
        ? odds.tokens.map((t) => ({
            outcome: t.outcome,
            impliedProb: t.impliedProb,
            bestBid: t.bestBid,
            bestAsk: t.bestAsk,
          }))
        : market.tokens.map((t) => ({
            outcome: t.outcome,
            impliedProb: t.price ?? null,
            bestBid: null,
            bestAsk: null,
          })),
      observedAt: odds?.observedAt ?? new Date().toISOString(),
    }));

    return NextResponse.json({ markets: payload, count: payload.length });
  } catch (error: any) {
    console.error("Polymarket search error:", error);
    return NextResponse.json(
      { error: "Polymarket API unavailable", message: error?.message },
      { status: 502 }
    );
  }
}
