/**
 * Team mapping utilities for converting between team names and sides (A/B).
 * 
 * A "side" is either "A" or "B", representing the position of a team in a match.
 * For imported matches, "A" = info.teams[0], "B" = info.teams[1]
 * For manual matches, "A" and "B" are whatever the user entered.
 */

export type TeamSide = "A" | "B";

export interface MatchTeams {
  teamA: string;
  teamB: string;
}

/**
 * Convert a team name to its side ("A" or "B") within a match.
 * 
 * @param match Object with teamA and teamB properties
 * @param teamName The team name to look up
 * @returns "A" or "B"
 * @throws Error if teamName is neither teamA nor teamB
 */
export function teamNameToSide(match: MatchTeams, teamName: string): TeamSide {
  if (teamName === match.teamA) return "A";
  if (teamName === match.teamB) return "B";
  throw new Error(
    `Team "${teamName}" not found in match. Expected one of: "${match.teamA}", "${match.teamB}"`
  );
}

/**
 * Convert a side ("A" or "B") to its team name within a match.
 * 
 * @param match Object with teamA and teamB properties
 * @param side The side to convert ("A" or "B")
 * @returns The team name for that side
 */
export function sideToTeamName(match: MatchTeams, side: TeamSide): string {
  return side === "A" ? match.teamA : match.teamB;
}
