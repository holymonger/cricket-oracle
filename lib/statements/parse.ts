import { StatementTemplate, SegmentXOvers } from "./types";

// Helper: parse "over 170.5" / "under 49.5"
function parseOverUnderAndLine(text: string): { direction: "over" | "under"; line: number } | null {
  const m = text.match(/\b(over|under)\s+(\d+(\.\d+)?)\b/i);
  if (!m) return null;
  return { direction: m[1].toLowerCase() as "over" | "under", line: Number(m[2]) };
}

// Helper: parse "180+" or "180 +"
function parseThresholdPlus(text: string): number | null {
  const m = text.match(/\b(\d+)\s*\+\b/);
  if (!m) return null;
  return Number(m[1]);
}

function parseInnings(text: string): 1 | 2 | null {
  if (/\b(1st|first|innings\s*1)\b/i.test(text)) return 1;
  if (/\b(2nd|second|innings\s*2)\b/i.test(text)) return 2;
  return null;
}

function parseSegmentXOvers(text: string): SegmentXOvers | null {
  // powerplay => 6
  if (/\bpowerplay\b/i.test(text)) return 6;

  // "0-6", "0 to 6", "first 6 overs"
  if (/\b0\s*[-to]+\s*6\b/i.test(text) || /\bfirst\s*6\s*overs\b/i.test(text)) return 6;
  if (/\b0\s*[-to]+\s*10\b/i.test(text) || /\bfirst\s*10\s*overs\b/i.test(text)) return 10;
  if (/\b0\s*[-to]+\s*12\b/i.test(text) || /\bfirst\s*12\s*overs\b/i.test(text)) return 12;

  return null;
}

// v0 parser: rule-based, deterministic.
// Notes:
// - We do NOT attempt to infer unknown teams.
// - For TEAM_* templates we require the user to include a team token like "Team A" or "MI".
export function parseStatement(statementText: string): StatementTemplate | null {
  const t = statementText.trim();

  // Winner incl super over
  // Examples:
  // - "Winner incl super over: Team A"
  // - "Team A to win (incl super over)"
  if (/\b(win|winner)\b/i.test(t) && /\b(super\s*over|incl\.?\s*super\s*over|including\s*super\s*over)\b/i.test(t)) {
    // Try "Team X" from "Team X to win..."
    const m = t.match(/^(.*?)(\bto\s+win\b|\bwinner\b|:)/i);
    const team = (m?.[1] ?? "").trim();
    if (team.length >= 2) {
      return { type: "MATCH_WINNER_INCL_SUPER_OVER", team };
    }
    // Try after ":" e.g. "Winner incl super over: Team A"
    const m2 = t.match(/:\s*(.+)$/);
    const team2 = (m2?.[1] ?? "").trim();
    if (team2.length >= 2) return { type: "MATCH_WINNER_INCL_SUPER_OVER", team: team2 };
  }

  // Innings runs 0->X over/under line
  // Examples:
  // - "1st innings powerplay over 49.5"
  // - "2nd innings 0-10 under 78.5"
  const xOvers = parseSegmentXOvers(t);
  const ou = parseOverUnderAndLine(t);
  const inns = parseInnings(t);
  if (xOvers && ou && inns) {
    return {
      type: "INNINGS_RUNS_0_TO_X_OVER_UNDER",
      innings: inns,
      xOvers,
      direction: ou.direction,
      line: ou.line,
    };
  }

  // Team innings total over/under
  // Example: "Team A over 170.5" (default innings 1 if not specified)
  if (ou && !xOvers) {
    const innings = inns ?? 1;
    // Team is everything before "over/under"
    const tm = t.match(/^(.*?)\b(over|under)\b/i);
    const team = (tm?.[1] ?? "").trim();
    // Avoid interpreting "match total over 330.5" as team
    if (team && !/\bmatch\s+total\b/i.test(team)) {
      return {
        type: "TEAM_INNINGS_TOTAL_OVER_UNDER",
        team,
        innings,
        direction: ou.direction,
        line: ou.line,
      };
    }
  }

  // Team reaches threshold (e.g., "Team A 180+")
  const thr = parseThresholdPlus(t);
  if (thr) {
    const innings = inns ?? 1;
    // Team is text before "180+"
    const team = t.split("+")[0].replace(String(thr), "").trim();
    if (team.length >= 2) {
      return {
        type: "TEAM_INNINGS_REACHES_THRESHOLD",
        team,
        innings,
        threshold: thr,
      };
    }
  }

  // Match total runs over/under
  // Example: "Match total over 329.5"
  if (ou && /\bmatch\s+total\b/i.test(t)) {
    return { type: "MATCH_TOTAL_RUNS_OVER_UNDER", direction: ou.direction, line: ou.line };
  }

  // Match total fours/sixes over/under
  if (ou && /\bmatch\s+total\s+fours\b/i.test(t)) {
    return { type: "MATCH_TOTAL_FOURS_OVER_UNDER", direction: ou.direction, line: ou.line };
  }
  if (ou && /\bmatch\s+total\s+(sixes|six)\b/i.test(t)) {
    return { type: "MATCH_TOTAL_SIXES_OVER_UNDER", direction: ou.direction, line: ou.line };
  }

  // Team total fours/sixes over/under
  if (ou && /\bfours\b/i.test(t) && !/\bmatch\s+total\b/i.test(t)) {
    const tm = t.match(/^(.*?)\bfours\b/i);
    const team = (tm?.[1] ?? "").trim();
    if (team.length >= 2) return { type: "TEAM_TOTAL_FOURS_OVER_UNDER", team, direction: ou.direction, line: ou.line };
  }
  if (ou && /\b(sixes|six)\b/i.test(t) && !/\bmatch\s+total\b/i.test(t)) {
    const tm = t.match(/^(.*?)\b(sixes|six)\b/i);
    const team = (tm?.[1] ?? "").trim();
    if (team.length >= 2) return { type: "TEAM_TOTAL_SIXES_OVER_UNDER", team, direction: ou.direction, line: ou.line };
  }

  return null;
}
