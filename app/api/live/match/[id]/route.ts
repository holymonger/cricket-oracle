/**
 * GET /api/live/match/[id]
 *
 * Returns the full scorecard for a match + live win probability from
 * the v5-lgbm LightGBM model.
 *
 * Only works for T20 matches — the model was trained on T20 data.
 * For other formats, winProb is returned as null.
 */

/**
 * GET /api/live/match/[id]
 *
 * Scorecard is cached 45s (live) / 10min (ended) server-side.
 * Browser polling every 45s → ~80 CricAPI hits/hour for 1 active match (under 100/hr limit).
 * Win probability is computed from cached data — zero extra API hits.
 *
 * Query params:
 *   force=true   — bust scorecard cache, force fresh CricAPI hit (costs 1 hit)
 */

import { NextRequest, NextResponse } from "next/server";
import { getMatchScorecard, getMatchInfo, extractLiveState, getCacheInfo } from "@/lib/providers/cricapi/client";
import { getRollbitCricketEvents } from "@/lib/providers/oddsapi/client";
import { getPreMatchStats } from "@/lib/cricket/preMatchStats";
import type { MatchState } from "@/lib/model/types";
import { computeWinProb } from "@/lib/model";

/** Fuzzy-match two CricAPI team names against a Rollbit event's home/away names. */
function rollbitMatchScore(home: string, away: string, teamA: string, teamB: string): number {
  const tok = (s: string) => s.toLowerCase().split(/[\s_\-]+/).filter((w) => w.length > 2);
  const homeTokens = tok(home);
  const awayTokens = tok(away);
  const aTokens = tok(teamA);
  const bTokens = tok(teamB);

  let score = 0;
  // Check if teamA matches home/away and teamB matches the other
  const aVsHome = aTokens.filter((w) => homeTokens.includes(w)).length;
  const bVsAway = bTokens.filter((w) => awayTokens.includes(w)).length;
  const aVsAway = aTokens.filter((w) => awayTokens.includes(w)).length;
  const bVsHome = bTokens.filter((w) => homeTokens.includes(w)).length;

  // Best alignment (normal or flipped)
  score = Math.max(aVsHome + bVsAway, aVsAway + bVsHome);
  return score;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  // Caller passes started=false for upcoming matches to skip scorecard attempt
  const matchStartedHint = searchParams.get("started") !== "false";

  try {
    // Skip scorecard for known-upcoming matches to avoid a wasted API hit
    let match;
    let usedInfoFallback = false;
    if (!matchStartedHint) {
      match = await getMatchInfo(id, force);
      usedInfoFallback = true;
    } else {
      try {
        match = await getMatchScorecard(id, force);
      } catch {
        match = await getMatchInfo(id, force);
        usedInfoFallback = true;
      }
    }
    const cacheKey = usedInfoFallback ? `info:${id}` : `scorecard:${id}`;
    const cacheInfo = getCacheInfo(cacheKey);
    const liveState = extractLiveState(match);

    let winProbTeamA: number | null = null;
    let modelVersion: string | null = null;

    // Only run model for T20 matches with at least 1 over bowled
    if (
      match.matchType === "t20" &&
      liveState.balls >= 6 &&
      !match.matchEnded &&
      liveState.battingTeamIdx !== null
    ) {
      try {
        const battingTeam = liveState.battingTeamIdx === 0 ? "A" : "B";
        const modelState: MatchState = {
          runs: liveState.runs,
          wickets: liveState.wickets,
          balls: Math.min(liveState.balls, 120),
          innings: liveState.innings as 1 | 2,
          targetRuns: liveState.target ?? undefined,
          battingTeam,
        };

        const result = computeWinProb(modelState);
        winProbTeamA = result.winProb;
        modelVersion = result.modelVersion;
      } catch (modelErr: any) {
        console.warn("Win prob model error:", modelErr?.message);
      }
    }

    // Pre-match win probability (Elo + H2H blended) — fallback to 50/50
    let preMatchWinProbA: number = 0.5;
    let preMatchDataPoints = 0;
    try {
      const stats = await getPreMatchStats(match.teams[0], match.teams[1], match.venue);
      preMatchWinProbA = stats.preMatchWinProbA;
      preMatchDataPoints = stats.dataPoints;
    } catch {
      // DB unavailable — use 50/50
    }

    // Rollbit odds — fuzzy-match by team name (non-blocking)
    let rollbit: {
      eventId: number; home: string; away: string; league: string;
      homeOdds: number | null; awayOdds: number | null;
      homeFair: number | null; awayFair: number | null;
      teamAIsHome: boolean;
    } | null = null;
    try {
      const events = await getRollbitCricketEvents(50);
      const [teamA, teamB] = match.teams;
      let best = null as null | { score: number; idx: number; flipped: boolean };
      events.forEach((ev, idx) => {
        const normal = rollbitMatchScore(ev.home, ev.away, teamA, teamB);
        const flipped = rollbitMatchScore(ev.home, ev.away, teamB, teamA);
        const score = Math.max(normal, flipped);
        if (score >= 2 && (!best || score > best.score)) {
          best = { score, idx, flipped: flipped > normal };
        }
      });
      if (best) {
        const ev = events[best.idx];
        rollbit = {
          eventId: ev.eventId,
          home: ev.home,
          away: ev.away,
          league: ev.league,
          homeOdds: ev.homeOdds,
          awayOdds: ev.awayOdds,
          homeFair: ev.homeFair,
          awayFair: ev.awayFair,
          // teamA is home unless we had to flip to get the match
          teamAIsHome: !best.flipped,
        };
      }
    } catch {
      // Rollbit unavailable — silently skip
    }

    // Full scorecard with batting/bowling details
    const scorecard = (match.scorecard ?? []).map((inn, i) => {
      const scoreEntry = match.score?.[i];
      return {
        innings: i + 1,
        inningName: scoreEntry?.inning ?? `Innings ${i + 1}`,
        totalRuns: scoreEntry?.r ?? 0,
        totalWickets: scoreEntry?.w ?? 0,
        totalOvers: scoreEntry?.o ?? 0,
        batting: inn.batting.map((b) => ({
          name: b.batsman.name,
          runs: b.r,
          balls: b.b,
          fours: b["4s"],
          sixes: b["6s"],
          strikeRate: b.sr,
          dismissal: b["dismissal-text"],
        })),
        bowling: inn.bowling.map((b) => ({
          name: b.bowler.name,
          overs: b.o,
          runs: b.r,
          wickets: b.w,
          economy: b.eco,
          wides: b.wd ?? 0,
          noBalls: b.nb ?? 0,
        })),
        extras: inn.extras ?? null,
        powerplay: inn.powerplay ?? null,
      };
    });

    return NextResponse.json({
      matchId: id,
      name: match.name,
      matchType: match.matchType,
      status: match.status,
      venue: match.venue,
      teams: match.teams,
      teamInfo: match.teamInfo,
      liveState,
      scorecard,
      winProb: (() => {
        const liveAvailable = winProbTeamA !== null;
        const resolvedProbA = liveAvailable ? winProbTeamA! : preMatchWinProbA;
        const isPreMatch = !liveAvailable;
        const noData = isPreMatch && preMatchDataPoints === 0;
        const displayVersion = liveAvailable
          ? modelVersion
          : noData ? "50/50 (no H2H data)" : "pre-match (Elo+H2H)";
        return {
          teamAWinProb: resolvedProbA,
          teamBWinProb: 1 - resolvedProbA,
          teamAName: liveState.teams[0],
          teamBName: liveState.teams[1],
          modelVersion: displayVersion,
          isPreMatch,
          note: null,
        };
      })(),
      rollbit,
      cache: {
        scorecardCachedAt: cacheInfo ? new Date(cacheInfo.fetchedAt).toISOString() : null,
        scorecardExpiresAt: cacheInfo ? new Date(cacheInfo.expiresAt).toISOString() : null,
        forceRefreshed: force,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`live/match/${id} error:`, error);
    return NextResponse.json(
      { error: "Failed to fetch match", message: error?.message },
      { status: 500 }
    );
  }
}
