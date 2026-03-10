/**
 * Test calibration functionality with sample inputs.
 */

import { calibrateProb, hasCalibration, getCalibrationInfo } from "../lib/model/calibration";
import { computeWinProbV3 } from "../lib/model/v3Lgbm";
import { MatchState } from "../lib/model/types";

console.log("=" .repeat(60));
console.log("Calibration Test");
console.log("=" .repeat(60));
console.log();

// Test 1: Check calibration availability
console.log("1. Calibration Availability");
const hasV3Calibration = hasCalibration("v3-lgbm");
console.log(`  v3-lgbm calibration available: ${hasV3Calibration}`);

if (hasV3Calibration) {
  const info = getCalibrationInfo("v3-lgbm");
  console.log(`  Method: ${info.method}`);
  console.log(`  Trained at: ${info.trainedAt}`);
  console.log(`  Notes: ${info.notes?.substring(0, 80)}...`);
}
console.log();

// Test 2: Direct calibration calls
console.log("2. Direct Calibration (v3-lgbm)");
const testProbs = [0.1, 0.3, 0.5, 0.7, 0.9];
testProbs.forEach(raw => {
  const calibrated = calibrateProb(raw, "v3-lgbm");
  const delta = calibrated - raw;
  console.log(`  ${raw.toFixed(2)} → ${calibrated.toFixed(4)} (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(4)})`);
});
console.log();

// Test 3: V3 model integration
console.log("3. V3 Model Integration");
const testState: MatchState = {
  innings: 2,
  battingTeam: "A",
  runs: 80,
  wickets: 3,
  balls: 60,
  targetRuns: 160,
};

console.log("  Test state:");
console.log(`    Innings 2, Team A batting`);
console.log(`    Score: ${testState.runs}/${testState.wickets} in ${Math.floor(testState.balls / 6)}.${testState.balls % 6} overs`);
console.log(`    Target: ${testState.targetRuns}`);
console.log();

const result = computeWinProbV3(testState);
console.log(`  Team A Win Prob: ${(result.winProb * 100).toFixed(2)}%`);
console.log(`  Model: ${result.modelVersion}`);
console.log(`  Features: ${Object.keys(result.features || {}).length} computed`);
console.log();

// Test 4: Monotonicity check
console.log("4. Monotonicity Check");
console.log("  Verifying calibrated probs maintain order...");
let monotonic = true;
for (let i = 0; i < 100; i++) {
  const p1 = i / 100;
  const p2 = (i + 1) / 100;
  const c1 = calibrateProb(p1, "v3-lgbm");
  const c2 = calibrateProb(p2, "v3-lgbm");
  if (c2 < c1) {
    console.log(`  ✗ Non-monotonic at ${p1.toFixed(3)}: ${c1.toFixed(4)} > ${c2.toFixed(4)}`);
    monotonic = false;
    break;
  }
}
if (monotonic) {
  console.log("  ✓ Monotonicity preserved");
}
console.log();

console.log("=" .repeat(60));
console.log("Test Complete");
console.log("=" .repeat(60));
