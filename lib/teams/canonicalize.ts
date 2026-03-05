/**
 * Team name canonicalization utilities
 * Normalizes team names for consistent matching across data sources
 */

/**
 * Known team name remappings for historical consistency
 */
const TEAM_REMAPPINGS: Record<string, string> = {
  "royal challengers bengaluru": "royal challengers bangalore",
  "delhi daredevils": "delhi capitals",
  "kings xi punjab": "punjab kings",
  "rising pune supergiant": "rising pune supergiants",
  "rising pune supergiants": "rising pune supergiants",
  // Add more as needed
};

/**
 * Canonicalize a team name for consistent matching
 * 
 * Steps:
 * 1. Lowercase and trim
 * 2. Replace punctuation with spaces: . , - & ' ( )
 * 3. Collapse multiple whitespace to single space
 * 4. Apply known remappings (e.g., RCB Bengaluru -> Bangalore)
 * 
 * @param name - Raw team name from any source
 * @returns Canonical team name
 */
export function canonicalizeTeamName(name: string): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  // Step 1: Lowercase and trim
  let canonical = name.toLowerCase().trim();

  // Step 2: Replace punctuation with spaces (safer than removing)
  canonical = canonical.replace(/[.,\-&'()]/g, " ");

  // Step 3: Collapse whitespace
  canonical = canonical.replace(/\s+/g, " ");

  // Step 4: Trim again after whitespace collapse
  canonical = canonical.trim();

  // Step 5: Apply remappings
  if (TEAM_REMAPPINGS[canonical]) {
    canonical = TEAM_REMAPPINGS[canonical];
  }

  return canonical;
}

/**
 * Check if two team names match after canonicalization
 */
export function teamNamesMatch(name1: string, name2: string): boolean {
  return canonicalizeTeamName(name1) === canonicalizeTeamName(name2);
}

/**
 * Get all known remappings (for debugging/testing)
 */
export function getKnownRemappings(): Record<string, string> {
  return { ...TEAM_REMAPPINGS };
}
