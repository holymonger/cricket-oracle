import { oversToBalls } from "./overs";

export type ExtractedScorecard = {
  runs?: number;
  wickets?: number;
  balls?: number;
  targetRuns?: number;
};

export function extractFromOcrText(rawText: string): {
  extracted: ExtractedScorecard;
  confidence: Record<string, number>;
} {
  try {
    const text = String(rawText ?? "");
    const compact = text.replace(/\s+/g, " ").trim();
    const extracted: ExtractedScorecard = {};
    const confidence: Record<string, number> = {};

    const totalMatch = compact.match(/\b(\d{1,3})\s*[\/-]\s*(\d{1,2})\b/);
    if (totalMatch) {
      const parsedRuns = Number(totalMatch[1]);
      const parsedWickets = Number(totalMatch[2]);
      if (Number.isFinite(parsedRuns)) {
        extracted.runs = parsedRuns;
        confidence.runs = 0.8;
      }
      if (Number.isFinite(parsedWickets)) {
        extracted.wickets = parsedWickets;
        confidence.wickets = 0.8;
      }
    }

    const oversPatterns = [
      /\bovers?\s*[:\-]?\s*(\d+\.\d)\b/i,
      /\b(\d+\.\d)\s*ov(?:ers?)?\b/i,
      /\(\s*(\d+\.\d)\s*\)/,
    ];

    for (const pattern of oversPatterns) {
      const oversMatch = compact.match(pattern);
      if (!oversMatch) {
        continue;
      }
      const parsedBalls = oversToBalls(oversMatch[1]);
      if (parsedBalls !== null) {
        extracted.balls = parsedBalls;
        confidence.balls = 0.7;
        break;
      }
    }

    const targetMatch = compact.match(/\btarget\s*[:\-]?\s*(\d{1,3})\b/i);
    if (targetMatch) {
      const parsedTarget = Number(targetMatch[1]);
      if (Number.isFinite(parsedTarget)) {
        extracted.targetRuns = parsedTarget;
        confidence.targetRuns = 0.8;
      }
    }

    if (extracted.targetRuns === undefined && extracted.runs !== undefined) {
      const chaseMatch = compact.match(/\bneed\s+(\d{1,3})\s+from\s+\d{1,3}\b/i);
      if (chaseMatch) {
        const runsNeeded = Number(chaseMatch[1]);
        if (Number.isFinite(runsNeeded)) {
          extracted.targetRuns = extracted.runs + runsNeeded;
          confidence.targetRuns = 0.5;
        }
      }
    }

    return { extracted, confidence };
  } catch {
    return { extracted: {}, confidence: {} };
  }
}
