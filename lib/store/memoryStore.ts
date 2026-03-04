import { MatchState } from "@/lib/statements/types";

export interface Match {
  id: string;
  teamA: string;
  teamB: string;
  createdAt: number; // timestamp in ms
}

export interface MatchSnapshot {
  matchId: string;
  timestamp: number; // timestamp in ms
  state: MatchState;
}

export interface StoredPrediction {
  snapshot: MatchSnapshot;
  winProb: number;
  statementResults?: unknown[];
}

// In-memory store: matchId => { match, snapshots }
const store: Map<
  string,
  {
    match: Match;
    snapshots: MatchSnapshot[];
  }
> = new Map();

export function createMatch(teamA: string, teamB: string): Match {
  const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const match: Match = {
    id: matchId,
    teamA,
    teamB,
    createdAt: Date.now(),
  };

  store.set(matchId, {
    match,
    snapshots: [],
  });

  return match;
}

export function getMatch(matchId: string): Match | null {
  const entry = store.get(matchId);
  return entry?.match ?? null;
}

export function appendSnapshot(matchId: string, state: MatchState): MatchSnapshot | null {
  const entry = store.get(matchId);
  if (!entry) return null;

  const snapshot: MatchSnapshot = {
    matchId,
    timestamp: Date.now(),
    state,
  };

  entry.snapshots.push(snapshot);
  return snapshot;
}

export function getSnapshots(matchId: string): MatchSnapshot[] {
  const entry = store.get(matchId);
  return entry?.snapshots ?? [];
}

export function getAllMatches(): Match[] {
  return Array.from(store.values()).map((e) => e.match);
}
