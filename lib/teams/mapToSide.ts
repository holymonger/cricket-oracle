/**
 * Map team names from market data to match sides (A or B)
 */

import { canonicalizeTeamName } from "./canonicalize";

/**
 * Error thrown when a team name cannot be mapped to either side
 */
export class TeamMappingError extends Error {
  details: any;
  constructor(details: any) {
    super("Team name could not be mapped to match.teamA/teamB");
    this.details = details;
  }
}

/**
 * Map a market team name to match side (A or B)
 * 
 * @param match - Match with teamA and teamB
 * @param teamNameFromMarket - Team name from market/odds provider
 * @returns "A" or "B"
 * @throws TeamMappingError if name doesn't match either side
 */
export function mapTeamNameToSide(
  match: { id: string; teamA: string; teamB: string },
  teamNameFromMarket: string
): "A" | "B" {
  const a = canonicalizeTeamName(match.teamA);
  const b = canonicalizeTeamName(match.teamB);
  const m = canonicalizeTeamName(teamNameFromMarket);

  if (m === a) return "A";
  if (m === b) return "B";

  throw new TeamMappingError({
    matchId: match.id,
    matchTeamA: match.teamA,
    matchTeamB: match.teamB,
    marketTeamName: teamNameFromMarket,
    canonical: { a, b, m },
  });
}

/**
 * Safe version that returns null instead of throwing
 */
export function tryMapTeamNameToSide(
  match: { id: string; teamA: string; teamB: string },
  teamNameFromMarket: string
): "A" | "B" | null {
  try {
    return mapTeamNameToSide(match, teamNameFromMarket);
  } catch (err) {
    if (err instanceof TeamMappingError) {
      return null;
    }
    throw err;
  }
}
