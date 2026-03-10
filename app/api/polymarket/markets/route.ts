/**
 * GET /api/polymarket/markets?q=cricket
 *
 * Returns live Polymarket cricket markets enriched with:
 *   - Gamma metadata: volume24hr, liquidity, outcome prices
 *   - CLOB live orderbook: best bid/ask per token → implied probability
 *   - Data API trade flow: recent trades, net buy pressure, per-outcome buy %
 */

import { NextRequest, NextResponse } from "next/server";
import { searchCricketMarketsEnriched } from "@/lib/providers/polymarket/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "cricket";

  try {
    const enriched = await searchCricketMarketsEnriched(query);

    const markets = enriched.map(({ market, odds, activity }) => ({
      id: market.id,
      conditionId: market.conditionId,
      question: market.question,
      slug: market.slug,
      endDate: market.endDate,
      volume: market.volume,
      volume24hr: market.volume24hr,
      volume1wk: market.volume1wk,
      liquidity: market.liquidity,
      // Tokens with Gamma prices + live CLOB mid-price
      tokens: market.tokens.map((token) => {
        const liveToken = odds?.tokens.find((t) => t.tokenId === token.tokenId);
        return {
          tokenId: token.tokenId,
          outcome: token.outcome,
          gammaPrice: token.price ?? 0.5,
          bestBid: liveToken?.bestBid ?? token.price ?? 0,
          bestAsk: liveToken?.bestAsk ?? token.price ?? 1,
          impliedProb: liveToken?.impliedProb ?? token.price ?? 0.5,
        };
      }),
      // Trade flow summary from Data API
      activity: activity
        ? {
            tradeCount: activity.recentTrades.length,
            totalRecentVolume: activity.totalRecentVolume,
            netBuyPressure: activity.netBuyPressure,
            outcomeBuyPressure: activity.outcomeBuyPressure,
          }
        : null,
      observedAt: new Date().toISOString(),
    }));

    return NextResponse.json({ markets, count: markets.length });
  } catch (error: any) {
    console.error("Polymarket markets enrichment error:", error);
    return NextResponse.json(
      { error: "Failed to fetch markets", message: error?.message },
      { status: 500 }
    );
  }
}
