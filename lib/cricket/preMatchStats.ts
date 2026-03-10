/**
 * Pre-match statistical intelligence.
 * Queries the Cricsheet-imported database for H2H records, venue analysis,
 * and recent team form to power pre-match probability estimates.
 */

import { prisma } from "@/lib/db/prisma";
import { getEloWinProb, type EloWinProbResult } from "./eloRatings";

export interface HeadToHeadStats {
  totalMatches: number;
  teamAWins: number;
  teamBWins: number;
  teamAWinPct: number;
  teamBWinPct: number;
  venueMatches: number;           // subset at this venue
  venueTeamAWins: number;
  venueTeamAWinPct: number;
  recentMatches: RecentMatch[];   // last 10 H2H encounters
  // Last-4-years subset (used for probability; shown separately in UI)
  recentYearsMatches: number;
  recentYearsTeamAWins: number;
  recentYearsTeamAWinPct: number;
}

export interface RecentMatch {
  matchDate: string | null;
  venue: string | null;
  winner: "A" | "B" | null;
  tossWinner: "A" | "B" | null;
  tossDecision: string | null;
}

export interface TeamFormStats {
  last10Wins: number;
  last10Losses: number;
  last10WinPct: number;
  avgFirstInningsScore: number;
  avgFirstInningsWickets: number;
  avgSecondInningsScore: number;
  tossWinRate: number;
  tossBatFirstRate: number;       // when they win toss, how often bat first
  venueAvgScore: number | null;   // average score at this specific venue
}

export interface VenueStats {
  venue: string;
  totalMatches: number;
  avgFirstInningsScore: number;
  avgSecondInningsScore: number;
  firstInningsWinPct: number;     // % of matches won by team batting first
  tossWinnerBatFirstPct: number;  // % of toss winners who chose to bat
}

export interface PreMatchStats {
  teamAName: string;
  teamBName: string;
  venue: string | null;
  headToHead: HeadToHeadStats;
  teamAForm: TeamFormStats;
  teamBForm: TeamFormStats;
  venueStats: VenueStats | null;
  preMatchWinProbA: number;       // blended estimate (Elo + H2H)
  dataPoints: number;             // H2H matches used
  elo: EloWinProbResult | null;   // Elo-based probability breakdown
}

/**
 * Fetch all pre-match statistics for a team pair (and optionally venue).
 * Team names should be the real team names as stored in the DB (teamAName / teamBName).
 */
export async function getPreMatchStats(
  teamAName: string,
  teamBName: string,
  venue?: string
): Promise<PreMatchStats> {
  // Find all matches between these two teams (either as teamA or teamB in DB)
  const allH2HMatches = await prisma.match.findMany({
    where: {
      source: "cricsheet",
      winnerTeam: { not: null },
      OR: [
        { teamAName: teamAName, teamBName: teamBName },
        { teamAName: teamBName, teamBName: teamAName },
      ],
    },
    orderBy: { matchDate: "desc" },
    select: {
      id: true,
      teamA: true,
      teamB: true,
      teamAName: true,
      teamBName: true,
      winnerTeam: true,
      tossWinnerTeam: true,
      tossDecision: true,
      matchDate: true,
      venue: true,
    },
  });

  // Find all recent matches for each team (last 30 matches)
  const [teamARecentRaw, teamBRecentRaw] = await Promise.all([
    prisma.match.findMany({
      where: {
        source: "cricsheet",
        winnerTeam: { not: null },
        OR: [{ teamAName: teamAName }, { teamBName: teamAName }],
      },
      orderBy: { matchDate: "desc" },
      take: 30,
      select: {
        teamA: true,
        teamB: true,
        teamAName: true,
        teamBName: true,
        winnerTeam: true,
        tossWinnerTeam: true,
        tossDecision: true,
        venue: true,
        innings1Runs: true,
        innings2Runs: true,
      },
    }),
    prisma.match.findMany({
      where: {
        source: "cricsheet",
        winnerTeam: { not: null },
        OR: [{ teamAName: teamBName }, { teamBName: teamBName }],
      },
      orderBy: { matchDate: "desc" },
      take: 30,
      select: {
        teamA: true,
        teamB: true,
        teamAName: true,
        teamBName: true,
        winnerTeam: true,
        tossWinnerTeam: true,
        tossDecision: true,
        venue: true,
        innings1Runs: true,
        innings2Runs: true,
      },
    }),
  ]);

  // Venue stats
  let venueMatchesRaw: Array<{
    teamA: string; teamB: string; teamAName: string | null; teamBName: string | null;
    winnerTeam: string | null; tossWinnerTeam: string | null; tossDecision: string | null;
    venue: string | null;
    innings1Runs: number | null; innings2Runs: number | null;
  }> = [];
  if (venue) {
    venueMatchesRaw = await prisma.match.findMany({
      where: {
        source: "cricsheet",
        winnerTeam: { not: null },
        venue: { contains: venue },
      },
      orderBy: { matchDate: "desc" },
      take: 50,
      select: {
        teamA: true,
        teamB: true,
        teamAName: true,
        teamBName: true,
        winnerTeam: true,
        tossWinnerTeam: true,
        tossDecision: true,
        venue: true,
        innings1Runs: true,
        innings2Runs: true,
      },
    });
  }

  // ---- Compute H2H stats (all-time + last-4-years subset) ----
  const now = new Date();
  const recentCutoff = new Date(now.getFullYear() - 4, now.getMonth(), now.getDate());
  const headToHead = computeH2H(allH2HMatches, teamAName, teamBName, venue, recentCutoff);

  // ---- Compute team form ----
  const teamAForm = computeTeamForm(teamARecentRaw, teamAName, venue);
  const teamBForm = computeTeamForm(teamBRecentRaw, teamBName, venue);

  // ---- Venue stats ----
  const venueStats = venue ? computeVenueStats(venueMatchesRaw, venue) : null;

  // ---- Pre-match win probability (simple Bayesian blend) ----
  // Use recent-4-year H2H when available (>=3 matches), fall back to all-time
  const h2hForProb =
    headToHead.recentYearsMatches >= 3
      ? { winPct: headToHead.recentYearsTeamAWinPct, count: headToHead.recentYearsMatches }
      : { winPct: headToHead.teamAWinPct, count: headToHead.totalMatches };

  // Weights: H2H 40%, team form 40%, venue advantage 20%
  let probA = 0.5;
  let weightSum = 0;

  if (h2hForProb.count >= 3) {
    probA += 0.4 * (h2hForProb.winPct - 0.5);
    weightSum += 0.4;
  }

  const formDelta = teamAForm.last10WinPct - teamBForm.last10WinPct;
  if (teamAForm.last10Wins + teamAForm.last10Losses >= 5) {
    probA += 0.4 * formDelta;
    weightSum += 0.4;
  }

  if (headToHead.venueMatches >= 3) {
    probA += 0.2 * (headToHead.venueTeamAWinPct - 0.5);
    weightSum += 0.2;
  }

  // Clamp to reasonable range
  probA = Math.max(0.1, Math.min(0.9, probA));

  // ── Elo-based probability ────────────────────────────────────────────────────
  const elo = await getEloWinProb(teamAName, teamBName);

  // Blend: when H2H data is thin, lean on Elo; when rich, lean on H2H
  // Use recent H2H count to determine Elo weight (recent data is more reliable)
  let blendedProbA = probA;
  if (elo) {
    const recentCount = headToHead.recentYearsMatches;
    // Elo weight: 0.8 with no recent H2H, 0.5 at 5 matches, 0.2 at 15+ matches
    const eloWeight = recentCount >= 15 ? 0.2 : recentCount >= 5 ? 0.5 : 0.8;
    blendedProbA = eloWeight * elo.teamAWinProb + (1 - eloWeight) * probA;
    blendedProbA = Math.max(0.05, Math.min(0.95, blendedProbA));
  }

  return {
    teamAName,
    teamBName,
    venue: venue ?? null,
    headToHead,
    teamAForm,
    teamBForm,
    venueStats,
    preMatchWinProbA: blendedProbA,
    dataPoints: allH2HMatches.length,
    elo,
  };
}

// ---- helpers ----

function computeH2H(
  matches: Array<{
    teamA: string; teamB: string; teamAName: string | null; teamBName: string | null;
    winnerTeam: string | null; tossWinnerTeam: string | null; tossDecision: string | null;
    matchDate: Date | null; venue: string | null;
  }>,
  teamAName: string,
  teamBName: string,
  venue?: string,
  recentCutoff?: Date
): HeadToHeadStats {
  let teamAWins = 0;
  let teamBWins = 0;
  let venueMatches = 0;
  let venueTeamAWins = 0;
  let recentYearsTeamAWins = 0;
  let recentYearsTotal = 0;

  const recentMatches: RecentMatch[] = [];

  for (const m of matches) {
    // The winner is stored as "A" or "B" relative to the DB's teamA/teamB
    // We need to map back to our teamAName / teamBName
    const dbTeamAIsOurA = m.teamAName === teamAName;
    let winner: "A" | "B" | null = null;
    if (m.winnerTeam === "A") winner = dbTeamAIsOurA ? "A" : "B";
    if (m.winnerTeam === "B") winner = dbTeamAIsOurA ? "B" : "A";

    if (winner === "A") teamAWins++;
    if (winner === "B") teamBWins++;

    // Recent-years subset
    const isRecent = !recentCutoff || (m.matchDate != null && m.matchDate >= recentCutoff);
    if (isRecent) {
      recentYearsTotal++;
      if (winner === "A") recentYearsTeamAWins++;
    }

    const atVenue = venue && m.venue && m.venue.toLowerCase().includes(venue.toLowerCase());
    if (atVenue) {
      venueMatches++;
      if (winner === "A") venueTeamAWins++;
    }

    let tossWinner: "A" | "B" | null = null;
    if (m.tossWinnerTeam === "A") tossWinner = dbTeamAIsOurA ? "A" : "B";
    if (m.tossWinnerTeam === "B") tossWinner = dbTeamAIsOurA ? "B" : "A";

    if (recentMatches.length < 10) {
      recentMatches.push({
        matchDate: m.matchDate?.toISOString().slice(0, 10) ?? null,
        venue: m.venue,
        winner,
        tossWinner,
        tossDecision: m.tossDecision,
      });
    }
  }

  const total = teamAWins + teamBWins;
  return {
    totalMatches: total,
    teamAWins,
    teamBWins,
    teamAWinPct: total > 0 ? teamAWins / total : 0.5,
    teamBWinPct: total > 0 ? teamBWins / total : 0.5,
    venueMatches,
    venueTeamAWins,
    venueTeamAWinPct: venueMatches > 0 ? venueTeamAWins / venueMatches : 0.5,
    recentMatches,
    recentYearsMatches: recentYearsTotal,
    recentYearsTeamAWins,
    recentYearsTeamAWinPct: recentYearsTotal > 0 ? recentYearsTeamAWins / recentYearsTotal : 0.5,
  };
}

function computeTeamForm(
  matches: Array<{
    teamA: string; teamB: string; teamAName: string | null; teamBName: string | null;
    winnerTeam: string | null; tossWinnerTeam: string | null; tossDecision: string | null;
    venue: string | null;
    innings1Runs: number | null; innings2Runs: number | null;
  }>,
  teamName: string,
  venue?: string
): TeamFormStats {
  const last10 = matches.slice(0, 10);
  let wins = 0;
  let losses = 0;
  let tossWins = 0;
  let tossBatFirst = 0;
  const innings1Scores: number[] = [];
  const innings2Scores: number[] = [];
  const venueScores: number[] = [];

  for (const m of last10) {
    const isTeamA = m.teamAName === teamName;
    const myDbSide = isTeamA ? "A" : "B";

    if (m.winnerTeam === myDbSide) wins++;
    else losses++;

    if (m.tossWinnerTeam === myDbSide) {
      tossWins++;
      if (m.tossDecision === "bat") tossBatFirst++;
    }

    if (m.innings1Runs != null) {
      innings1Scores.push(m.innings1Runs);
      if (venue && m.venue?.toLowerCase().includes(venue.toLowerCase())) {
        venueScores.push(m.innings1Runs);
      }
    }
  }

  for (const m of matches) {
    if (m.innings2Runs != null) innings2Scores.push(m.innings2Runs);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    last10Wins: wins,
    last10Losses: losses,
    last10WinPct: wins + losses > 0 ? wins / (wins + losses) : 0.5,
    avgFirstInningsScore: avg(innings1Scores),
    avgFirstInningsWickets: 0,
    avgSecondInningsScore: avg(innings2Scores),
    tossWinRate: last10.length > 0 ? tossWins / last10.length : 0.5,
    tossBatFirstRate: tossWins > 0 ? tossBatFirst / tossWins : 0.5,
    venueAvgScore: venueScores.length > 0 ? avg(venueScores) : null,
  };
}

function computeVenueStats(
  matches: Array<{
    winnerTeam: string | null; tossWinnerTeam: string | null; tossDecision: string | null;
    venue: string | null;
    innings1Runs: number | null; innings2Runs: number | null;
  }>,
  venue: string
): VenueStats {
  const innings1Scores: number[] = [];
  const innings2Scores: number[] = [];
  let battingFirstWins = 0;
  let tossWinnerBatFirst = 0;
  let total = 0;

  for (const m of matches) {
    total++;
    if (m.innings1Runs != null) innings1Scores.push(m.innings1Runs);
    if (m.innings2Runs != null) innings2Scores.push(m.innings2Runs);

    if (m.winnerTeam === "A") battingFirstWins++;
    if (m.tossDecision === "bat") tossWinnerBatFirst++;
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    venue,
    totalMatches: total,
    avgFirstInningsScore: avg(innings1Scores),
    avgSecondInningsScore: avg(innings2Scores),
    firstInningsWinPct: total > 0 ? battingFirstWins / total : 0.5,
    tossWinnerBatFirstPct: total > 0 ? tossWinnerBatFirst / total : 0.5,
  };
}
