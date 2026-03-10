import { computeWinProbV43LogReg } from "../lib/model/v43LogReg";
import type { MatchState } from "../lib/model/types";

const scenarios: Array<[string, MatchState]> = [
  ["last ball need 7, 8 wkts down",  { innings: 2, battingTeam: "A", runs: 153, wickets: 8, balls: 119, targetRuns: 160 }],
  ["start of chase 0/0 vs 160",      { innings: 2, battingTeam: "A", runs: 0,   wickets: 0, balls: 0,   targetRuns: 160 }],
  ["1st inn 100/0 off 10 overs",     { innings: 1, battingTeam: "A", runs: 100, wickets: 0, balls: 60 }],
  ["1st inn 60/6 off 10 overs",      { innings: 1, battingTeam: "A", runs: 60,  wickets: 6, balls: 60 }],
  ["near-certain 150/1 off 19 ovs",  { innings: 2, battingTeam: "A", runs: 150, wickets: 1, balls: 114, targetRuns: 160 }],
];

for (const [label, state] of scenarios) {
  const r = computeWinProbV43LogReg(state);
  console.log(label.padEnd(32) + (r.winProb * 100).toFixed(1) + "%");
}
