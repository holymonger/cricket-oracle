import { Prisma } from "@prisma/client";

/**
 * Uniquely identifies a ball in a match
 */
export type BallKey = {
  innings: 1 | 2;
  over: number;
  ballInOver: number;
};

/**
 * Match with team info and optional winner
 */
export interface MatchInfo {
  id: string;
  teamA: string;
  teamB: string;
  winnerTeam?: string | null;
}

/**
 * Ball event from the database
 */
export interface BallEventRecord {
  id: string;
  matchId: string;
  innings: number;
  over: number;
  ballInOver: number;
  legalBallNumber: number | null;
  battingTeam: string;
  runsBat: number;
  runsExtras: number;
  runsTotal: number;
  isWide: boolean;
  isNoBall: boolean;
  isWicket: boolean;
}

/**
 * Derived state after a ball is delivered
 * Tracks cumulative metrics for the current innings
 */
export interface DerivedBallState {
  // Identification
  innings: 1 | 2;
  over: number;
  ballInOver: number;
  legalBallNumber: number | null; // 1..120 per innings, null for illegal balls
  
  // Counters (cumulative in this innings)
  runs: number; // Total runs in this innings
  wickets: number; // Total wickets in this innings
  balls: number; // Legal balls faced in this innings
  
  // Match context
  battingTeam: "A" | "B";
  targetRuns?: number; // For innings 2: firstInningsRuns + 1
  
  // Ball details
  runsThisBall: number; // Runs from this delivery
  isWide: boolean;
  isNoBall: boolean;
  isWicket: boolean;
  isLegalBall: boolean;
}

/**
 * Item returned from buildStatesFromBallEvents
 */
export interface BallStateItem {
  event: BallEventRecord;
  stateAfterEvent: DerivedBallState;
}

/**
 * Build derived states from a flat list of BallEvent records
 * 
 * Assumes events are sorted by (innings, over, ballInOver) in ascending order.
 * Computes cumulative runs, wickets, legal balls for each innings.
 * For innings 2, derives targetRuns from first innings total.
 */
export function buildStatesFromBallEvents(
  match: MatchInfo,
  events: BallEventRecord[]
): BallStateItem[] {
  const result: BallStateItem[] = [];

  // Track state for each innings separately
  let inningsRunsByNumber: Record<number, number> = {};
  let inningsWicketsByNumber: Record<number, number> = {};
  let inningsLegalBallsByNumber: Record<number, number> = {};

  for (const event of events) {
    const inningsNum = event.innings;
    const isLegalBall = !event.isWide && !event.isNoBall;

    // Initialize innings if needed
    if (!(inningsNum in inningsRunsByNumber)) {
      inningsRunsByNumber[inningsNum] = 0;
      inningsWicketsByNumber[inningsNum] = 0;
      inningsLegalBallsByNumber[inningsNum] = 0;
    }

    // Increment counters AFTER this ball
    inningsRunsByNumber[inningsNum] += event.runsTotal;
    if (event.isWicket) {
      inningsWicketsByNumber[inningsNum]++;
    }
    if (isLegalBall) {
      inningsLegalBallsByNumber[inningsNum]++;
    }

    // Determine target runs for innings 2
    let targetRuns: number | undefined;
    if (inningsNum === 2 && inningsRunsByNumber[1] !== undefined) {
      targetRuns = inningsRunsByNumber[1] + 1;
    }

    const stateAfterEvent: DerivedBallState = {
      innings: inningsNum as 1 | 2,
      over: event.over,
      ballInOver: event.ballInOver,
      legalBallNumber: event.legalBallNumber,
      runs: inningsRunsByNumber[inningsNum],
      wickets: inningsWicketsByNumber[inningsNum],
      balls: inningsLegalBallsByNumber[inningsNum],
      battingTeam: event.battingTeam as "A" | "B",
      targetRuns,
      runsThisBall: event.runsTotal,
      isWide: event.isWide,
      isNoBall: event.isNoBall,
      isWicket: event.isWicket,
      isLegalBall,
    };

    result.push({
      event,
      stateAfterEvent,
    });
  }

  return result;
}
