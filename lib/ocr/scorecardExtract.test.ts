import { describe, expect, it } from "vitest";
import { oversToBalls } from "./overs";
import { extractFromOcrText } from "./scorecardExtract";

describe("oversToBalls", () => {
  it("converts valid overs values", () => {
    expect(oversToBalls("0.0")).toBe(0);
    expect(oversToBalls("5.0")).toBe(30);
    expect(oversToBalls("12.3")).toBe(75);
  });

  it("returns null for invalid overs string", () => {
    expect(oversToBalls("12.8")).toBeNull();
    expect(oversToBalls("abc")).toBeNull();
  });
});

describe("extractFromOcrText", () => {
  it("extracts 123/4 + 12.3 overs + target 178", () => {
    const result = extractFromOcrText("Score 123/4, Overs 12.3, Target 178");

    expect(result.extracted).toEqual({
      runs: 123,
      wickets: 4,
      balls: 75,
      targetRuns: 178,
    });
    expect(result.confidence.runs).toBe(0.8);
    expect(result.confidence.wickets).toBe(0.8);
    expect(result.confidence.balls).toBe(0.7);
    expect(result.confidence.targetRuns).toBe(0.8);
  });

  it("extracts dash score and ov format", () => {
    const result = extractFromOcrText("45-2 after 5.0 ov");

    expect(result.extracted).toEqual({ runs: 45, wickets: 2, balls: 30 });
  });

  it("infers target from need X from Y when runs known", () => {
    const result = extractFromOcrText("Current 120/4. Need 50 from 30");

    expect(result.extracted.runs).toBe(120);
    expect(result.extracted.wickets).toBe(4);
    expect(result.extracted.targetRuns).toBe(170);
    expect(result.confidence.targetRuns).toBe(0.5);
  });

  it("returns empty extracted when no scorecard patterns exist", () => {
    const result = extractFromOcrText("Hello world, nothing to parse here");

    expect(result.extracted).toEqual({});
    expect(result.confidence).toEqual({});
  });

  it("handles weird spacing and newlines", () => {
    const text = `
      TEAM A   99 / 3
      ( 14.2 )
      TARGET:   155
    `;

    const result = extractFromOcrText(text);

    expect(result.extracted.runs).toBe(99);
    expect(result.extracted.wickets).toBe(3);
    expect(result.extracted.balls).toBe(86);
    expect(result.extracted.targetRuns).toBe(155);
  });
});
