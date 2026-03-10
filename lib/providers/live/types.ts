/**
 * Provider interface for live cricket deliveries
 * Abstraction layer to support multiple data sources (simulators, APIs, etc.)
 */

export type LiveCursor = string | null;

export interface LiveFetchInput {
  matchId: string;
  cursor: LiveCursor;
  /** Optional: max deliveries to fetch in one call */
  take?: number;
}

export interface LiveDeliveryInput {
  matchId: string;
  innings: 1 | 2;
  over: number;
  ballInOver: number;
  battingTeamName: string; // "A" | "B" or team name
  strikerName: string;
  nonStrikerName: string;
  bowlerName: string;
  runs: {
    total: number;
    bat?: number;
    extras?: number;
  };
  extras?: {
    wides?: number;
    noballs?: number;
    byes?: number;
    legbyes?: number;
  };
  wickets?: Array<Record<string, unknown>>;
  targetRuns?: number; // required for innings 2
  provider?: string;
  providerEventId?: string;
  occurredAt?: string; // ISO datetime
}

export interface LiveFetchOutput {
  deliveries: LiveDeliveryInput[];
  nextCursor: LiveCursor;
}

export interface LiveDeliveryProvider {
  name: string;
  fetchNext(input: LiveFetchInput): Promise<LiveFetchOutput>;
}
