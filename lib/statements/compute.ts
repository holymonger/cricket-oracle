import { MatchState, StatementComputeResult, StatementTemplate } from "./types";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Same v0 chase win probability as your API (we'll dedupe later).
function winProbChaseV0(state: MatchState) {
  const ballsRemaining = 120 - state.balls;

  if (state.innings !== 2 || !state.targetRuns) {
    return { ok: false as const, error: "Chase model requires innings=2 and targetRuns." };
  }

  const runsRemaining = state.targetRuns - state.runs;
  if (runsRemaining <= 0) return { ok: true as const, winProb: 1, ballsRemaining, runsRemaining };
  if (ballsRemaining <= 0) return { ok: true as const, winProb: 0, ballsRemaining, runsRemaining };
  if (state.wickets >= 10) return { ok: true as const, winProb: 0, ballsRemaining, runsRemaining };

  const reqRr = (runsRemaining * 6) / ballsRemaining;
  const curRr = state.balls > 0 ? (state.runs * 6) / state.balls : 0;
  const wicketsInHand = 10 - state.wickets;

  const x = 0.9 * (curRr - reqRr) + 0.12 * wicketsInHand + 0.004 * ballsRemaining;
  const winProb = clamp01(1 / (1 + Math.exp(-x)));

  return { ok: true as const, winProb, ballsRemaining, runsRemaining, reqRr, curRr };
}

function getRuns0ToX(state: MatchState, xOvers: 6 | 10 | 12): { ok: true; runs: number } | { ok: false; missing: string[] } {
  // If checkpoint exists, use it (best).
  if (xOvers === 6 && state.runsAfter6 != null) return { ok: true, runs: state.runsAfter6 };
  if (xOvers === 10 && state.runsAfter10 != null) return { ok: true, runs: state.runsAfter10 };
  if (xOvers === 12 && state.runsAfter12 != null) return { ok: true, runs: state.runsAfter12 };

  // If match hasn't reached X overs yet, we can estimate based on current scoring rate (rough v0).
  const ballsAtX = xOvers * 6;
  if (state.balls <= ballsAtX) {
    const rrPerBall = state.balls > 0 ? state.runs / state.balls : 0;
    const est = Math.round(rrPerBall * ballsAtX);
    return { ok: true, runs: est };
  }

  // If match already passed X overs and user didn't enter checkpoint, require manual field.
  const missing =
    xOvers === 6 ? ["runsAfter6"] : xOvers === 10 ? ["runsAfter10"] : ["runsAfter12"];
  return { ok: false, missing };
}

// v0 distribution approximation for totals:
// Treat final total as Normal(mean, sd) where mean is projected by run rate with wicket penalty.
// This is not "world-class" yet; it's just to get a working end-to-end system.
function probFinalTotalOverLineV0(state: MatchState, line: number): number {
  const ballsRemaining = 120 - state.balls;
  const wicketsInHand = 10 - state.wickets;

  const curPerBall = state.balls > 0 ? state.runs / state.balls : 0.9; // fallback
  const wicketPenalty = 0.06 * (10 - wicketsInHand); // more wickets lost => lower future rate
  const adjPerBall = Math.max(0.4, curPerBall - wicketPenalty);

  const meanFinal = state.runs + adjPerBall * ballsRemaining;

  // crude uncertainty: more balls remaining => larger sd; fewer wickets => larger risk
  const sd = 10 + 0.18 * ballsRemaining + 0.8 * (10 - wicketsInHand);

  // Normal CDF approximation via logistic
  const z = (meanFinal - line) / sd;
  const pOver = clamp01(1 / (1 + Math.exp(-1.7 * z)));
  return pOver;
}

export function computeStatementProbability(state: MatchState, template: StatementTemplate): StatementComputeResult {
  const modelVersion = "v0";

  switch (template.type) {
    case "MATCH_WINNER_INCL_SUPER_OVER": {
      // v0: only meaningful live in innings 2. Otherwise 50/50 placeholder.
      if (state.innings === 2 && state.targetRuns) {
        const r = winProbChaseV0(state);
        if (!r.ok) return { ok: false, error: r.error };
        return {
          ok: true,
          template,
          probability: r.winProb,
          explanation: "v0 chase model based on required RR, current RR, wickets, balls remaining.",
          modelVersion,
        };
      }
      return {
        ok: true,
        template,
        probability: 0.5,
        explanation: "v0 placeholder (pre-match / innings 1 not modeled yet).",
        modelVersion,
      };
    }

    case "INNINGS_RUNS_0_TO_X_OVER_UNDER": {
      const seg = getRuns0ToX(state, template.xOvers);
      if (!seg.ok) {
        return {
          ok: false,
          template,
          error: "Missing checkpoint for this segment (match already passed that over).",
          missing: seg.missing,
          supportedExamples: [
            "1st innings powerplay over 49.5",
            "2nd innings 0-10 under 78.5",
            "1st innings 0-12 over 96.5",
          ],
        };
      }

      const pOver = clamp01(1 / (1 + Math.exp(-0.35 * (seg.runs - template.line))));
      const p = template.direction === "over" ? pOver : 1 - pOver;

      return {
        ok: true,
        template,
        probability: p,
        explanation:
          "v0 segment model. If checkpoint not entered and segment not completed, estimates runs by current run rate. If completed, requires manual checkpoint.",
        modelVersion,
      };
    }

    case "TEAM_INNINGS_TOTAL_OVER_UNDER": {
      const pOver = probFinalTotalOverLineV0(state, template.line);
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return {
        ok: true,
        template,
        probability: p,
        explanation: "v0 total model using projected final total and rough uncertainty.",
        modelVersion,
      };
    }

    case "TEAM_INNINGS_REACHES_THRESHOLD": {
      const pOver = probFinalTotalOverLineV0(state, template.threshold);
      return {
        ok: true,
        template,
        probability: pOver,
        explanation: "v0 threshold model derived from projected final total distribution.",
        modelVersion,
      };
    }

    case "MATCH_TOTAL_RUNS_OVER_UNDER": {
      // v0: only uses current innings state as if it were the total driver (placeholder).
      const pOver = probFinalTotalOverLineV0(state, template.line);
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return {
        ok: true,
        template,
        probability: p,
        explanation: "v0 placeholder for match total; will become (innings1 + innings2 forecast) later.",
        modelVersion,
      };
    }

    case "MATCH_TOTAL_FOURS_OVER_UNDER": {
      if (state.matchFours == null) {
        return {
          ok: false,
          template,
          error: "This prop requires manual field matchFours (until a feed is added).",
          missing: ["matchFours"],
          supportedExamples: ["Match total fours over 29.5"],
        };
      }
      const pOver = clamp01(1 / (1 + Math.exp(-0.6 * (state.matchFours - template.line))));
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: p, explanation: "v0 boundary placeholder using current count only.", modelVersion };
    }

    case "MATCH_TOTAL_SIXES_OVER_UNDER": {
      if (state.matchSixes == null) {
        return {
          ok: false,
          template,
          error: "This prop requires manual field matchSixes (until a feed is added).",
          missing: ["matchSixes"],
          supportedExamples: ["Match total sixes under 14.5"],
        };
      }
      const pOver = clamp01(1 / (1 + Math.exp(-0.6 * (state.matchSixes - template.line))));
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: p, explanation: "v0 boundary placeholder using current count only.", modelVersion };
    }

    case "TEAM_TOTAL_FOURS_OVER_UNDER": {
      if (state.teamFours == null) {
        return {
          ok: false,
          template,
          error: "This prop requires manual field teamFours (until a feed is added).",
          missing: ["teamFours"],
          supportedExamples: ["Team A fours over 18.5"],
        };
      }
      const pOver = clamp01(1 / (1 + Math.exp(-0.6 * (state.teamFours - template.line))));
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: p, explanation: "v0 team boundary placeholder using current count only.", modelVersion };
    }

    case "TEAM_TOTAL_SIXES_OVER_UNDER": {
      if (state.teamSixes == null) {
        return {
          ok: false,
          template,
          error: "This prop requires manual field teamSixes (until a feed is added).",
          missing: ["teamSixes"],
          supportedExamples: ["Team A sixes under 7.5"],
        };
      }
      const pOver = clamp01(1 / (1 + Math.exp(-0.6 * (state.teamSixes - template.line))));
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: p, explanation: "v0 team boundary placeholder using current count only.", modelVersion };
    }

    default:
      return { ok: false, error: "Unsupported template." };
  }
}
