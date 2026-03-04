import { describe, it, expect } from "vitest";
import { computeWinProbV1 } from "./v1Logistic";
import { MatchState } from "./types";

describe("computeWinProbV1", () => {
  it("innings 2: higher required run rate => lower Team A win% when battingTeam=A", () => {
    const baseState: MatchState = {
      innings: 2,
      battingTeam: "A",
      runs: 80,
      wickets: 3,
      balls: 60,
      targetRuns: 150,
    };

    // RRR = (150 - 80) * 6 / (120 - 60) = 420 / 60 = 7.0
    const result1 = computeWinProbV1(baseState);

    // Higher target: RRR = (165 - 80) * 6 / 60 = 510 / 60 = 8.5
    const result2 = computeWinProbV1({ ...baseState, targetRuns: 165 });

    expect(result2.winProb).toBeLessThan(result1.winProb);
  });

  it("innings 2: flipping battingTeam inverts probability around 0.5", () => {
    const baseState: MatchState = {
      innings: 2,
      battingTeam: "A",
      runs: 85,
      wickets: 2,
      balls: 60,
      targetRuns: 160,
    };

    const resultA = computeWinProbV1(baseState);
    const resultB = computeWinProbV1({ ...baseState, battingTeam: "B" });

    // Should invert: Team A win% = 1 - (Team B batting win%)
    expect(resultA.winProb).toBeCloseTo(1 - resultB.winProb);
  });

  it("innings 2: more wickets in hand => higher batting win%", () => {
    const baseState: MatchState = {
      innings: 2,
      battingTeam: "A",
      runs: 80,
      wickets: 5, // 5 down, 5 in hand
      balls: 60,
      targetRuns: 150,
    };

    const result1 = computeWinProbV1(baseState);
    const result2 = computeWinProbV1({ ...baseState, wickets: 3 }); // 3 wickets down, 7 in hand

    expect(result2.winProb).toBeGreaterThan(result1.winProb);
  });

  it("innings 2: run out of balls => Team A win% = 0", () => {
    const state: MatchState = {
      innings: 2,
      battingTeam: "A",
      runs: 140,
      wickets: 3,
      balls: 120, // all balls done
      targetRuns: 150,
    };

    const result = computeWinProbV1(state);
    expect(result.winProb).toBe(0);
  });

  it("innings 2: all 10 wickets down => Team A win% = 0", () => {
    const state: MatchState = {
      innings: 2,
      battingTeam: "A",
      runs: 145,
      wickets: 10,
      balls: 100,
      targetRuns: 150,
    };

    const result = computeWinProbV1(state);
    expect(result.winProb).toBe(0);
  });

  it("innings 2: target already reached => Team A win% = 1", () => {
    const state: MatchState = {
      innings: 2,
      battingTeam: "A",
      runs: 155,
      wickets: 3,
      balls: 80,
      targetRuns: 150,
    };

    const result = computeWinProbV1(state);
    expect(result.winProb).toBe(1);
  });

  it("innings 1: higher projected score => higher Team A win%", () => {
    const baseState: MatchState = {
      innings: 1,
      battingTeam: "A",
      runs: 60,
      wickets: 2,
      balls: 30,
    };

    const result1 = computeWinProbV1(baseState);

    // More runs after same balls => higher RR => higher projected score
    const result2 = computeWinProbV1({ ...baseState, runs: 80 });

    expect(result2.winProb).toBeGreaterThan(result1.winProb);
  });

  it("all outputs are finite and within (0, 1)", () => {
    const states: MatchState[] = [
      {
        innings: 1,
        battingTeam: "A",
        runs: 50,
        wickets: 0,
        balls: 30,
      },
      {
        innings: 2,
        battingTeam: "B",
        runs: 100,
        wickets: 5,
        balls: 80,
        targetRuns: 180,
      },
      {
        innings: 2,
        battingTeam: "A",
        runs: 5,
        wickets: 8,
        balls: 110,
        targetRuns: 160,
      },
    ];

    states.forEach((state) => {
      const result = computeWinProbV1(state);
      expect(Number.isFinite(result.winProb)).toBe(true);
      expect(result.winProb).toBeGreaterThanOrEqual(0.01);
      expect(result.winProb).toBeLessThanOrEqual(0.99);
      expect(result.modelVersion).toBe("v1");
      expect(typeof result.features).toBe("object");
    });
  });
});
