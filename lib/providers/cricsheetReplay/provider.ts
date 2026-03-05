/**
 * Cricsheet Replay Provider
 * Simulates live cricket feed by replaying BallEvent rows from database
 * Used for testing real-time infrastructure without external API
 */

import { prisma } from "../../../lib/db/prisma";
import type {
  LiveProvider,
  FetchEventsInput,
} from "../types";
import type {
  CanonicalDeliveryEvent,
  FetchEventsResult,
  TeamSide,
} from "../../live/types";

/**
 * Parse cursor in format: "innings:over:ballInOver"
 * Returns starting point for next fetch
 */
function parseCursor(cursor?: string): {
  innings: number;
  over: number;
  ballInOver: number;
} | null {
  if (!cursor) return null;

  const parts = cursor.split(":");
  if (parts.length !== 3) return null;

  const innings = parseInt(parts[0], 10);
  const over = parseInt(parts[1], 10);
  const ballInOver = parseInt(parts[2], 10);

  if (isNaN(innings) || isNaN(over) || isNaN(ballInOver)) return null;

  return { innings, over, ballInOver };
}

/**
 * Create cursor from delivery position
 */
function makeCursor(innings: number, over: number, ballInOver: number): string {
  return `${innings}:${over}:${ballInOver}`;
}

/**
 * Cricsheet replay provider implementation
 */
export class CricsheetReplayProvider implements LiveProvider {
  readonly name = "cricsheet-replay";

  /**
   * Fetch ball events from database to simulate live feed
   */
  async fetchNewEvents(input: FetchEventsInput): Promise<FetchEventsResult> {
    const { matchId, cursor, limit = 1 } = input;

    // Parse cursor position
    const cursorPos = parseCursor(cursor);

    // Build query to fetch next events
    const whereConditions: any = {
      matchId,
    };

    if (cursorPos) {
      // Fetch events AFTER cursor position
      whereConditions.OR = [
        { innings: { gt: cursorPos.innings } },
        {
          AND: [
            { innings: cursorPos.innings },
            { over: { gt: cursorPos.over } },
          ],
        },
        {
          AND: [
            { innings: cursorPos.innings },
            { over: cursorPos.over },
            { ballInOver: { gt: cursorPos.ballInOver } },
          ],
        },
      ];
    }

    // Fetch ball events with player details
    const ballEvents = await prisma.ballEvent.findMany({
      where: whereConditions,
      include: {
        striker: { select: { name: true } },
        nonStriker: { select: { name: true } },
        bowler: { select: { name: true } },
      },
      orderBy: [{ innings: "asc" }, { over: "asc" }, { ballInOver: "asc" }],
      take: limit,
    });

    // Convert to canonical format
    const events: CanonicalDeliveryEvent[] = ballEvents.map((ball: any) => {
      const providerEventId = `${matchId}:${ball.innings}:${ball.over}:${ball.ballInOver}`;

      // Parse extras JSON
      let extras: CanonicalDeliveryEvent["extras"] = undefined;
      if (ball.extrasJson && typeof ball.extrasJson === "object") {
        const extrasObj = ball.extrasJson as any;
        extras = {
          wides: extrasObj.wides ?? undefined,
          noballs: extrasObj.noballs ?? undefined,
          byes: extrasObj.byes ?? undefined,
          legbyes: extrasObj.legbyes ?? undefined,
        };
      }

      // Parse wickets JSON
      let wickets: CanonicalDeliveryEvent["wickets"] = undefined;
      if (ball.wicketJson && Array.isArray(ball.wicketJson)) {
        wickets = (ball.wicketJson as any[]).map((w) => ({
          playerOut: w.player_out || "",
          kind: w.kind || "",
          fielders: w.fielders || [],
        }));
      }

      const isLegal = !ball.isWide && !ball.isNoBall;

      return {
        matchId,
        provider: this.name,
        providerEventId,
        innings: ball.innings as 1 | 2,
        over: ball.over,
        ballInOver: ball.ballInOver,
        battingTeam: ball.battingTeam as TeamSide,
        striker: ball.striker.name,
        nonStriker: ball.nonStriker.name,
        bowler: ball.bowler.name,
        runsBat: ball.runsBat,
        runsExtras: ball.runsExtras,
        runsTotal: ball.runsTotal,
        extras,
        wickets,
        isWide: ball.isWide,
        isNoBall: ball.isNoBall,
        isLegal,
        occurredAt: ball.createdAt.toISOString(),
      };
    });

    // Compute next cursor
    let nextCursor: string | undefined = undefined;
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      nextCursor = makeCursor(
        lastEvent.innings,
        lastEvent.over,
        lastEvent.ballInOver
      );
    }

    return {
      events,
      nextCursor,
    };
  }

  /**
   * Optional: List matches available for replay
   */
  async listLiveMatches() {
    const matches = await prisma.match.findMany({
      where: {
        winnerTeam: { not: null }, // Only completed matches
      },
      select: {
        id: true,
        sourceMatchId: true,
        teamA: true,
        teamB: true,
        winnerTeam: true,
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    return matches.map((m: any) => ({
      matchId: m.id,
      title: `${m.teamA} vs ${m.teamB}`,
      status: `Winner: ${m.winnerTeam}`,
    }));
  }
}

/**
 * Singleton instance
 */
export const cricsheetReplayProvider = new CricsheetReplayProvider();
