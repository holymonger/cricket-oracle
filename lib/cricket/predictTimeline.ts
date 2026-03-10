import {
  DerivedBallState,
  BallStateItem,
  MatchInfo,
  BallEventRecord,
} from "./stateFromBalls";
import { computeWinProbV1 } from "@/lib/model/v1Logistic";

/**
 * Single point on the win probability timeline
 */
export interface TimelinePoint {
  // Ball identification
  innings: 1 | 2;
  over: number;
  ballInOver: number;
  ballLabel: string; // "1.1", "3.4", etc.
  ballNumberInInnings: number; // 1..120, only incremented for legal balls
  ballNumberInMatch: number; // 1..240, all balls

  // Prediction
  teamAWinProb: number; // 0..100

  // State snapshot
  runs: number; // Team runs in this innings
  wickets: number;
  runsThisBall: number;
  battingTeam: "A" | "B";
  targetRuns?: number;

  // Event markers
  isWicket: boolean;
  isFour: boolean; // 4 runs from batting team
  isSix: boolean; // 6 runs from batting team
  isWide: boolean;
  isNoBall: boolean;
  isLegalBall: boolean;
}

/**
 * Summary of first and second innings
 */
export interface TimelineSummary {
  firstInningsRuns: number;
  firstInningsWickets: number;
  secondInningsTarget?: number;
  secondInningsRuns?: number;
  secondInningsWickets?: number;
  result: "in-progress" | "completed" | "unknown"; // Based on match.winnerTeam
}

/**
 * Complete timeline result
 */
export interface PredictTimelineResult {
  match: MatchInfo;
  timeline: TimelinePoint[];
  summary: TimelineSummary;
}

function defaultComputeWinProb(state: DerivedBallState): number {
  const result = computeWinProbV1({
    innings: state.innings,
    runs: state.runs,
    wickets: state.wickets,
    balls: state.balls,
    targetRuns: state.targetRuns ?? null,
    battingTeam: state.battingTeam,
  });
  // timeline expects 0–100
  return result.winProb * 100;
}

/**
 * Build a win probability timeline from ball state items.
 * Uses v1 model by default; pass computeWinProbFn to override.
 */
export async function predictWinProbTimeline(
  match: MatchInfo,
  ballStateItems: BallStateItem[],
  modelVersion: string = "v1",
  computeWinProbFn?: (state: DerivedBallState, version: string) => number
): Promise<PredictTimelineResult> {
  const computeWinProb = computeWinProbFn
    ? computeWinProbFn
    : (s: DerivedBallState) => defaultComputeWinProb(s);

  const timeline: TimelinePoint[] = [];
  let ballNumberInMatch = 0;

  // Extract first innings totals
  let firstInningsRuns = 0;
  let firstInningsWickets = 0;
  let secondInningsTarget: number | undefined;

  for (const item of ballStateItems) {
    if (item.stateAfterEvent.innings === 1) {
      firstInningsRuns = item.stateAfterEvent.runs;
      firstInningsWickets = item.stateAfterEvent.wickets;
    }
  }

  // Build timeline
  for (const item of ballStateItems) {
    const { event, stateAfterEvent } = item;
    ballNumberInMatch++;

    // Only add prediction for legal balls
    if (stateAfterEvent.isLegalBall && stateAfterEvent.legalBallNumber !== null) {
      const teamAWinProb = computeWinProb(stateAfterEvent, modelVersion);

      const ballLabel = `${stateAfterEvent.over}.${stateAfterEvent.ballInOver}`;

      // Determine 4/6 markers
      let isFour = false;
      let isSix = false;
      if (!stateAfterEvent.isWide && !stateAfterEvent.isNoBall) {
        if (stateAfterEvent.runsThisBall === 4) isFour = true;
        else if (stateAfterEvent.runsThisBall === 6) isSix = true;
      }

      if (stateAfterEvent.innings === 2 && !secondInningsTarget && firstInningsRuns > 0) {
        secondInningsTarget = firstInningsRuns + 1;
      }

      timeline.push({
        innings: stateAfterEvent.innings,
        over: stateAfterEvent.over,
        ballInOver: stateAfterEvent.ballInOver,
        ballLabel,
        ballNumberInInnings: stateAfterEvent.legalBallNumber,
        ballNumberInMatch,
        teamAWinProb,
        runs: stateAfterEvent.runs,
        wickets: stateAfterEvent.wickets,
        runsThisBall: stateAfterEvent.runsThisBall,
        battingTeam: stateAfterEvent.battingTeam,
        targetRuns: stateAfterEvent.targetRuns,
        isWicket: stateAfterEvent.isWicket,
        isFour,
        isSix,
        isWide: stateAfterEvent.isWide,
        isNoBall: stateAfterEvent.isNoBall,
        isLegalBall: stateAfterEvent.isLegalBall,
      });
    }
  }

  // Determine result status
  let result: "in-progress" | "completed" | "unknown" = "unknown";
  if (match.winnerTeam !== null && match.winnerTeam !== undefined) {
    result = "completed";
  } else if (timeline.length > 0) {
    result = "in-progress";
  }

  // Extract second innings summary if available
  let secondInningsRuns: number | undefined;
  let secondInningsWickets: number | undefined;
  for (const item of ballStateItems) {
    if (item.stateAfterEvent.innings === 2) {
      secondInningsRuns = item.stateAfterEvent.runs;
      secondInningsWickets = item.stateAfterEvent.wickets;
    }
  }

  const summary: TimelineSummary = {
    firstInningsRuns,
    firstInningsWickets,
    secondInningsTarget,
    secondInningsRuns,
    secondInningsWickets,
    result,
  };

  return {
    match,
    timeline,
    summary,
  };
}
