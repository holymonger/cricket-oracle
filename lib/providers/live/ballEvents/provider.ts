/**
 * BallEvents provider: replays imported BallEvent rows as a live feed
 * Converts existing historical data into LiveDelivery payloads
 * Useful for testing predictions and edge signals without external APIs
 */

import { LiveDeliveryProvider, LiveFetchInput, LiveFetchOutput, LiveDeliveryInput } from "../types";
import { prisma } from "@/lib/db/prisma";

class BallEventsProvider implements LiveDeliveryProvider {
  readonly name = "ball-events";
  private inningsTargetCache: Map<string, number> = new Map();

  async fetchNext(input: LiveFetchInput): Promise<LiveFetchOutput> {
    const { matchId, cursor } = input;

    // Verify match exists
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, teamA: true, teamB: true },
    });

    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Get target runs for innings 2 (compute if not cached)
    const cacheKey = `${matchId}:target`;
    if (!this.inningsTargetCache.has(cacheKey)) {
      const innings1Total = await this.computeInnings1Total(matchId);
      this.inningsTargetCache.set(cacheKey, innings1Total + 1);
    }
    const targetRuns = this.inningsTargetCache.get(cacheKey)!;

    // Find next legal BallEvent
    const nextBallEvent = await this.getNextLegalBallEvent(matchId, cursor);

    if (!nextBallEvent) {
      return {
        deliveries: [],
        nextCursor: cursor,
      };
    }

    // Convert to LiveDeliveryInput
    const delivery = this.convertBallEventToDelivery(
      nextBallEvent,
      match,
      targetRuns
    );

    return {
      deliveries: [delivery],
      nextCursor: nextBallEvent.id,
    };
  }

  private async getNextLegalBallEvent(matchId: string, cursor: string | null) {
    // Skip to cursor first (if provided)
    const cursorBallEvent = cursor
      ? await prisma.ballEvent.findUnique({ where: { id: cursor } })
      : null;

    // Build query: find next legal ball after cursor
    const query: any = {
      where: {
        matchId,
        legalBallNumber: { not: null },
        isWide: false,
        isNoBall: false,
      },
      include: {
        striker: true,
        nonStriker: true,
        bowler: true,
      },
      orderBy: [
        { innings: "asc" },
        { legalBallNumber: "asc" },
        { over: "asc" },
        { ballInOver: "asc" },
      ],
      take: 1,
    };

    // If cursor provided, find the next after current innings/legalBallNumber
    if (cursorBallEvent && cursorBallEvent.legalBallNumber) {
      query.where.OR = [
        {
          innings: cursorBallEvent.innings,
          legalBallNumber: { gt: cursorBallEvent.legalBallNumber },
        },
        {
          innings: { gt: cursorBallEvent.innings },
          legalBallNumber: { not: null },
        },
      ];
    }

    const result = await prisma.ballEvent.findFirst(query);
    return result;
  }

  private async computeInnings1Total(matchId: string): Promise<number> {
    const result = await prisma.ballEvent.aggregate({
      where: {
        matchId,
        innings: 1,
        legalBallNumber: { not: null },
      },
      _sum: { runsTotal: true },
    });

    return result._sum.runsTotal || 0;
  }

  private convertBallEventToDelivery(
    ballEvent: any,
    match: any,
    targetRuns: number
  ): LiveDeliveryInput {
    // Map battin team "A"/"B" to actual team name
    const battingTeamName =
      ballEvent.battingTeam === "A" ? match.teamA : match.teamB;

    // Build extras object from extrasJson
    const extras = ballEvent.extrasJson || {};

    // Wickets array from wicketJson
    const wickets = ballEvent.wicketJson || [];

    const delivery: LiveDeliveryInput = {
      matchId: ballEvent.matchId,
      innings: ballEvent.innings,
      over: ballEvent.over,
      ballInOver: ballEvent.ballInOver,
      battingTeamName,
      strikerName: ballEvent.striker.name,
      nonStrikerName: ballEvent.nonStriker.name,
      bowlerName: ballEvent.bowler.name,
      runs: {
        total: ballEvent.runsTotal,
        bat: ballEvent.runsBat,
        extras: ballEvent.runsExtras,
      },
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      wickets: wickets.length > 0 ? wickets : undefined,
      provider: this.name,
      providerEventId: `ballEvent:${ballEvent.id}`,
      occurredAt: ballEvent.createdAt.toISOString(),
    };

    // Add targetRuns for innings 2
    if (ballEvent.innings === 2) {
      delivery.targetRuns = targetRuns;
    }

    return delivery;
  }
}

export const ballEventsProviderInstance = new BallEventsProvider();
