import { MatchState, StatementComputeResult, StatementTemplate } from "./types";
import { computeWinProbV0 } from "@/lib/model/v0";
import { simulate, simulateFullMatch, isDeliveryTablesAvailable, type SimState } from "@/lib/cricket/mcSimulation";

// ── Constants ─────────────────────────────────────────────────────────────────

const MC_N = 5000; // simulations per request

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// ── v0 fallbacks (kept for when delivery tables are not built yet) ────────────

function winProbChaseV0(state: MatchState) {
  const ballsRemaining = 120 - state.balls;
  if (state.innings !== 2 || !state.targetRuns) {
    return { ok: false as const, error: "Chase model requires innings=2 and targetRuns." };
  }
  const runsRemaining = state.targetRuns - state.runs;
  if (runsRemaining <= 0) return { ok: true as const, winProb: 1, ballsRemaining, runsRemaining };
  if (ballsRemaining <= 0) return { ok: true as const, winProb: 0, ballsRemaining, runsRemaining };
  if (state.wickets >= 10) return { ok: true as const, winProb: 0, ballsRemaining, runsRemaining };
  const result = computeWinProbV0(state);
  const battingWinProb = state.battingTeam === "A" ? result.winProb : 1 - result.winProb;
  const reqRr = (runsRemaining * 6) / ballsRemaining;
  const curRr = state.balls > 0 ? (state.runs * 6) / state.balls : 0;
  return { ok: true as const, winProb: battingWinProb, ballsRemaining, runsRemaining, reqRr, curRr };
}

function probFinalTotalOverLineV0(state: MatchState, line: number): number {
  const ballsRemaining = 120 - state.balls;
  const wicketsInHand = 10 - state.wickets;
  const curPerBall = state.balls > 0 ? state.runs / state.balls : 0.9;
  const wicketPenalty = 0.06 * (10 - wicketsInHand);
  const adjPerBall = Math.max(0.4, curPerBall - wicketPenalty);
  const meanFinal = state.runs + adjPerBall * ballsRemaining;
  const sd = 10 + 0.18 * ballsRemaining + 0.8 * (10 - wicketsInHand);
  const z = (meanFinal - line) / sd;
  return clamp01(1 / (1 + Math.exp(-1.7 * z)));
}

function projectBoundariesToLine(currentCount: number, ballsBowled: number, line: number, avgPerBall: number): number {
  const ballsRemaining = Math.max(0, 240 - ballsBowled);
  const projected = currentCount + ballsRemaining * avgPerBall;
  const sd = Math.max(0.5, Math.sqrt(ballsRemaining * avgPerBall * (1 - avgPerBall)) * 1.4);
  const z = (projected - line) / sd;
  return clamp01(1 / (1 + Math.exp(-1.7 * z)));
}

// ── Segment checkpoint helper ────────────────────────────────────────────────

function getRuns0ToX(state: MatchState, xOvers: 6 | 10 | 12): { ok: true; runs: number } | { ok: false; missing: string[] } {
  if (xOvers === 6  && state.runsAfter6  != null) return { ok: true, runs: state.runsAfter6 };
  if (xOvers === 10 && state.runsAfter10 != null) return { ok: true, runs: state.runsAfter10 };
  if (xOvers === 12 && state.runsAfter12 != null) return { ok: true, runs: state.runsAfter12 };
  const ballsAtX = xOvers * 6;
  if (state.balls <= ballsAtX) {
    const rrPerBall = state.balls > 0 ? state.runs / state.balls : 0;
    return { ok: true, runs: Math.round(rrPerBall * ballsAtX) };
  }
  const missing = xOvers === 6 ? ["runsAfter6"] : xOvers === 10 ? ["runsAfter10"] : ["runsAfter12"];
  return { ok: false, missing };
}

// ── MC helpers ────────────────────────────────────────────────────────────────

function stateToSimState(state: MatchState): SimState {
  return {
    innings: state.innings,
    runs: state.runs,
    wickets: state.wickets,
    balls: state.balls,
    target: state.targetRuns ?? undefined,
  };
}

// ── Main compute function ─────────────────────────────────────────────────────

export function computeStatementProbability(state: MatchState, template: StatementTemplate): StatementComputeResult {
  const hasMC = isDeliveryTablesAvailable();
  const modelVersion = hasMC ? "mc-v1" : "v0";

  switch (template.type) {

    // ── Match winner ──────────────────────────────────────────────────────────
    case "MATCH_WINNER_INCL_SUPER_OVER": {
      if (state.innings === 2 && state.targetRuns) {
        if (hasMC) {
          const mc = simulate(stateToSimState(state), MC_N);
          const battingWinProb = mc.pWin;
          const p = template.team === (state.battingTeam ?? "A") ? battingWinProb : 1 - battingWinProb;
          return {
            ok: true, template, probability: clamp01(p), modelVersion,
            explanation: `MC: ${mc.n} simulations from current state. Batting team wins ${(mc.pWin * 100).toFixed(1)}% of sims.`,
          };
        }
        // v0 fallback
        const r = winProbChaseV0(state);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, template, probability: r.winProb, explanation: "v0 chase model.", modelVersion };
      }
      return { ok: true, template, probability: 0.5, explanation: "Pre-match/innings-1 placeholder.", modelVersion };
    }

    // ── Innings total over/under ──────────────────────────────────────────────
    case "TEAM_INNINGS_TOTAL_OVER_UNDER": {
      let pOver: number;
      let explanation: string;

      if (hasMC) {
        const mc = simulate(stateToSimState(state), MC_N);
        pOver = mc.pRunsAtLeast(template.line + (template.direction === "over" ? 0.5 : 0));
        explanation = `MC: ${mc.n} sims — mean final ${mc.meanRuns.toFixed(1)} ± ${mc.sdRuns.toFixed(1)} runs.`;
      } else {
        pOver = probFinalTotalOverLineV0(state, template.line);
        explanation = "v0 total model (run build:delivery-tables to enable MC).";
      }

      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: clamp01(p), explanation, modelVersion };
    }

    // ── Innings reaches threshold ─────────────────────────────────────────────
    case "TEAM_INNINGS_REACHES_THRESHOLD": {
      let pOver: number;
      let explanation: string;

      if (hasMC) {
        const mc = simulate(stateToSimState(state), MC_N);
        pOver = mc.pRunsAtLeast(template.threshold);
        explanation = `MC: ${mc.n} sims — team reaches ${template.threshold} in ${(pOver * 100).toFixed(1)}% of sims.`;
      } else {
        pOver = probFinalTotalOverLineV0(state, template.threshold);
        explanation = "v0 threshold model.";
      }

      return { ok: true, template, probability: clamp01(pOver), explanation, modelVersion };
    }

    // ── Match total runs ──────────────────────────────────────────────────────
    case "MATCH_TOTAL_RUNS_OVER_UNDER": {
      let p: number;
      let explanation: string;

      if (hasMC) {
        if (state.innings === 1) {
          // Simulate remainder of innings 1, then full innings 2
          const mc = simulateFullMatch(stateToSimState(state), MC_N);
          const pOver = mc.pMatchRunsAtLeast(template.line + (template.direction === "over" ? 0.5 : 0));
          p = template.direction === "over" ? pOver : 1 - pOver;
          explanation = `MC full-match: ${mc.n} sims of innings 1 remainder + innings 2.`;
        } else {
          // Innings 2 in progress — innings 1 already complete, use current runs as innings 1 total
          // Approximate innings 1 total from target - 1
          const innings1Runs = (state.targetRuns ?? 160) - 1;
          const mc = simulate(stateToSimState(state), MC_N);
          const matchRunsSims = mc.sims.map((s) => innings1Runs + s.finalRuns);
          const line = template.line;
          const countOver = matchRunsSims.filter((r) => r >= line + (template.direction === "over" ? 0.5 : 0)).length;
          const pOver = countOver / mc.n;
          p = template.direction === "over" ? pOver : 1 - pOver;
          explanation = `MC: innings 2 simulation added to innings 1 total (${innings1Runs}).`;
        }
      } else {
        const pOver = probFinalTotalOverLineV0(state, template.line);
        p = template.direction === "over" ? pOver : 1 - pOver;
        explanation = "v0 placeholder for match total.";
      }

      return { ok: true, template, probability: clamp01(p), explanation, modelVersion };
    }

    // ── Segment markets (powerplay / 0-10 / 0-12) ────────────────────────────
    case "INNINGS_RUNS_0_TO_X_OVER_UNDER": {
      const seg = getRuns0ToX(state, template.xOvers);
      if (!seg.ok) {
        return {
          ok: false, template,
          error: "Missing checkpoint for this segment (match already passed that over).",
          missing: seg.missing,
          supportedExamples: ["1st innings powerplay over 49.5", "2nd innings 0-10 under 78.5"],
        };
      }

      let p: number;
      let explanation: string;

      if (hasMC && state.balls < template.xOvers * 6) {
        // Segment not yet complete — simulate remaining balls until ball X
        const ballsTarget = template.xOvers * 6;
        const ballsLeft = ballsTarget - state.balls;
        // Simulate from current state and project runs to the segment boundary
        const segState: SimState = {
          innings: state.innings,
          runs: state.runs,
          wickets: state.wickets,
          balls: state.balls,
        };
        const mc = simulate(segState, MC_N);
        // MC simulates to end of innings, but segment ends at xOvers
        // Approximate: use the fraction of remaining segment balls to estimate distribution
        // P(reach line by over X) ≈ P(runs at end of innings × (ballsLeft/ballsRemaining) >= line - runs)
        const ballsRemaining = 120 - state.balls;
        const fraction = Math.min(1, ballsLeft / ballsRemaining);
        const pOver = mc.sims.filter((s) => {
          const segRuns = state.runs + (s.finalRuns - state.runs) * fraction;
          return segRuns >= template.line + (template.direction === "over" ? 0.5 : 0);
        }).length / mc.n;
        p = template.direction === "over" ? pOver : 1 - pOver;
        explanation = `MC segment: projecting to over ${template.xOvers}.`;
      } else {
        // Segment already complete or no MC — use sharp logistic on actual/estimated runs
        const pOver = clamp01(1 / (1 + Math.exp(-0.35 * (seg.runs - template.line))));
        p = template.direction === "over" ? pOver : 1 - pOver;
        explanation = seg.runs !== undefined
          ? `Segment complete: ${seg.runs} runs vs line ${template.line}.`
          : "v0 estimate.";
      }

      return { ok: true, template, probability: clamp01(p), explanation, modelVersion };
    }

    // ── Match total fours ─────────────────────────────────────────────────────
    case "MATCH_TOTAL_FOURS_OVER_UNDER": {
      if (hasMC) {
        // MC: simulate remaining deliveries, track fours
        const mc = state.innings === 1
          ? simulateFullMatch(stateToSimState(state), MC_N)
          : null;
        const mcInnings = !mc ? simulate(stateToSimState(state), MC_N) : null;

        // Estimate fours already scored using global average (0.115/ball) if not provided
        const foursAlreadyScored = state.matchFours
          ?? Math.round(state.balls * 0.115); // rough estimate if not provided

        let pOver: number;
        let explanation: string;

        if (mc) {
          // Innings 1 in progress: project both innings
          const remainingLine = Math.max(0, template.line - foursAlreadyScored);
          pOver = mc.pMatchFoursAtLeast(remainingLine);
          explanation = `MC: both innings simulated. Estimated fours so far: ${foursAlreadyScored}.`;
        } else {
          // Innings 2: only remaining innings to simulate
          const remainingLine = Math.max(0, template.line - foursAlreadyScored);
          pOver = mcInnings!.pFoursAtLeast(remainingLine);
          explanation = `MC: innings 2 remainder simulated. Fours so far: ${foursAlreadyScored}.`;
        }
        const p = template.direction === "over" ? pOver : 1 - pOver;
        return { ok: true, template, probability: clamp01(p), explanation, modelVersion };
      }

      // v0 fallback — requires manual input
      if (state.matchFours == null) {
        return { ok: false, template, error: "Requires matchFours field (or run build:delivery-tables for MC).", missing: ["matchFours"] };
      }
      const pOver = projectBoundariesToLine(state.matchFours, state.balls, template.line, 0.115);
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: clamp01(p), explanation: "v0 boundary projection.", modelVersion };
    }

    // ── Match total sixes ─────────────────────────────────────────────────────
    case "MATCH_TOTAL_SIXES_OVER_UNDER": {
      if (hasMC) {
        const mc = state.innings === 1
          ? simulateFullMatch(stateToSimState(state), MC_N)
          : null;
        const mcInnings = !mc ? simulate(stateToSimState(state), MC_N) : null;

        const sixesAlreadyScored = state.matchSixes
          ?? Math.round(state.balls * 0.04);

        let pOver: number;
        let explanation: string;

        if (mc) {
          const remainingLine = Math.max(0, template.line - sixesAlreadyScored);
          pOver = mc.pMatchSixesAtLeast(remainingLine);
          explanation = `MC: both innings simulated. Estimated sixes so far: ${sixesAlreadyScored}.`;
        } else {
          const remainingLine = Math.max(0, template.line - sixesAlreadyScored);
          pOver = mcInnings!.pSixesAtLeast(remainingLine);
          explanation = `MC: innings 2 remainder. Sixes so far: ${sixesAlreadyScored}.`;
        }
        const p = template.direction === "over" ? pOver : 1 - pOver;
        return { ok: true, template, probability: clamp01(p), explanation, modelVersion };
      }

      if (state.matchSixes == null) {
        return { ok: false, template, error: "Requires matchSixes field (or run build:delivery-tables for MC).", missing: ["matchSixes"] };
      }
      const pOver = projectBoundariesToLine(state.matchSixes, state.balls, template.line, 0.04);
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: clamp01(p), explanation: "v0 boundary projection.", modelVersion };
    }

    // ── Team fours ────────────────────────────────────────────────────────────
    case "TEAM_TOTAL_FOURS_OVER_UNDER": {
      if (hasMC) {
        const mc = simulate(stateToSimState(state), MC_N);
        const foursAlready = state.teamFours ?? Math.round(state.balls * 0.115);
        const remainingLine = Math.max(0, template.line - foursAlready);
        const pOver = mc.pFoursAtLeast(remainingLine);
        const p = template.direction === "over" ? pOver : 1 - pOver;
        return {
          ok: true, template, probability: clamp01(p), modelVersion,
          explanation: `MC: ${mc.n} sims. Fours so far ~${foursAlready}, need ${remainingLine} more.`,
        };
      }
      if (state.teamFours == null) {
        return { ok: false, template, error: "Requires teamFours field (or run build:delivery-tables for MC).", missing: ["teamFours"] };
      }
      const pOver = projectBoundariesToLine(state.teamFours, state.balls, template.line, 0.115);
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: clamp01(p), explanation: "v0 boundary projection.", modelVersion };
    }

    // ── Team sixes ────────────────────────────────────────────────────────────
    case "TEAM_TOTAL_SIXES_OVER_UNDER": {
      if (hasMC) {
        const mc = simulate(stateToSimState(state), MC_N);
        const sixesAlready = state.teamSixes ?? Math.round(state.balls * 0.04);
        const remainingLine = Math.max(0, template.line - sixesAlready);
        const pOver = mc.pSixesAtLeast(remainingLine);
        const p = template.direction === "over" ? pOver : 1 - pOver;
        return {
          ok: true, template, probability: clamp01(p), modelVersion,
          explanation: `MC: ${mc.n} sims. Sixes so far ~${sixesAlready}, need ${remainingLine} more.`,
        };
      }
      if (state.teamSixes == null) {
        return { ok: false, template, error: "Requires teamSixes field (or run build:delivery-tables for MC).", missing: ["teamSixes"] };
      }
      const pOver = projectBoundariesToLine(state.teamSixes, state.balls, template.line, 0.04);
      const p = template.direction === "over" ? pOver : 1 - pOver;
      return { ok: true, template, probability: clamp01(p), explanation: "v0 boundary projection.", modelVersion };
    }

    default:
      return { ok: false, error: "Unsupported template." };
  }
}
