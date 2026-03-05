/**
 * Canonical types for real-time ball-by-ball cricket feeds
 * Provider-agnostic representation of delivery events
 */

export type TeamSide = "A" | "B";

/**
 * Canonical delivery event - normalized format from any provider
 * Stores delivery details with idempotent providerEventId
 */
export interface CanonicalDeliveryEvent {
  /** Match identifier in our system */
  matchId: string;

  /** Provider name (e.g., "cricsheet-replay", "cricbuzz-live") */
  provider: string;

  /** Unique stable ID from provider for idempotency */
  providerEventId: string;

  /** Innings number (1 or 2) */
  innings: 1 | 2;

  /** Over number (0-based internally) */
  over: number;

  /** Ball number in over (1..n, includes illegal deliveries) */
  ballInOver: number;

  /** Batting team side */
  battingTeam: TeamSide;

  /** Batsman on strike */
  striker: string;

  /** Batsman at non-striker end */
  nonStriker: string;

  /** Bowler */
  bowler: string;

  /** Runs scored off bat */
  runsBat: number;

  /** Runs from extras */
  runsExtras: number;

  /** Total runs for this delivery */
  runsTotal: number;

  /** Breakdown of extras */
  extras?: {
    wides?: number;
    noballs?: number;
    byes?: number;
    legbyes?: number;
  };

  /** Wicket details if any */
  wickets?: Array<{
    playerOut: string;
    kind: string;
    fielders?: string[];
  }>;

  /** Wide ball flag */
  isWide: boolean;

  /** No ball flag */
  isNoBall: boolean;

  /** Legal delivery (counts toward over) */
  isLegal: boolean;

  /** Timestamp when delivery occurred (ISO 8601) */
  occurredAt?: string;
}

/**
 * Provider fetch result with cursor-based pagination
 */
export interface FetchEventsResult {
  /** Canonical delivery events */
  events: CanonicalDeliveryEvent[];

  /** Opaque cursor for next fetch */
  nextCursor?: string;
}

/**
 * Match state at a point in time (for real-time tracking)
 */
export interface LiveMatchState {
  matchId: string;
  innings: number;
  battingTeam: TeamSide;
  runs: number;
  wickets: number;
  balls: number;
  overs: number;
  target?: number;
  lastUpdate: Date;
}
