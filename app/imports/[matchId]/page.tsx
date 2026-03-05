"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface TimelinePoint {
  innings: 1 | 2;
  over: number;
  ballInOver: number;
  ballLabel?: string;
  ballNumberInInnings?: number;
  ballNumberInMatch?: number;
  legalBallNumber?: number;
  teamAWinProb: number;
  runs: number;
  wickets: number;
  ballOutcome?: number;
  runsThisBall?: number;
  battingTeam?: "A" | "B";
  targetRuns?: number;
  isWicket: boolean;
  isFour: boolean;
  isSix: boolean;
  isWide?: boolean;
  isNoBall?: boolean;
  isLegalBall?: boolean;
}

interface TimelineData {
  match: {
    id: string;
    teamA: string;
    teamB: string;
    ballCount: number;
    sourceMatchId?: string;
  };
  timeline: TimelinePoint[];
  summary: {
    firstInningsRuns?: number;
    firstInningsWickets?: number;
    secondInningsTarget?: number;
    secondInningsRuns?: number;
    secondInningsWickets?: number;
    result?: string;
    ballCount?: number;
    inningsCount?: number;
    finalWinProb?: number;
  };
  modelVersion?: string;
  error?: string;
  message?: string;
}

export default function TimelinePage() {
  const params = useParams();
  const matchId = params.matchId as string;

  const [primary, setPrimary] = useState<TimelineData | null>(null);
  const [compare, setCompare] = useState<TimelineData | null>(null);
  const [primaryModel, setPrimaryModel] = useState("v3-lgbm");
  const [compareModel, setCompareModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredBall, setHoveredBall] = useState<number | null>(null);
  const [showWickets, setShowWickets] = useState(true);
  const [compareLoading, setCompareLoading] = useState(false);

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        setLoading(true);
        const adminKey = localStorage.getItem("adminKey");
        const res = await fetch(
          `/api/matches/${matchId}/timeline?modelVersion=${primaryModel}`,
          {
            headers: {
              "x-admin-key": adminKey || "",
            },
          }
        );

        const result = await res.json();

        if (!res.ok) {
          setError(result.error || `HTTP ${res.status}`);
          setPrimary(null);
        } else {
          setPrimary(result);
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch timeline");
        setPrimary(null);
      } finally {
        setLoading(false);
      }
    };

    if (matchId) {
      fetchTimeline();
    }
  }, [matchId, primaryModel]);

  useEffect(() => {
    if (!compareModel) {
      setCompare(null);
      return;
    }

    const fetchCompareTimeline = async () => {
      try {
        setCompareLoading(true);
        const adminKey = localStorage.getItem("adminKey");
        const res = await fetch(
          `/api/matches/${matchId}/timeline?modelVersion=${compareModel}`,
          {
            headers: {
              "x-admin-key": adminKey || "",
            },
          }
        );

        const result = await res.json();

        if (!res.ok) {
          setCompare(null);
        } else {
          setCompare(result);
        }
      } catch (err) {
        setCompare(null);
      } finally {
        setCompareLoading(false);
      }
    };

    fetchCompareTimeline();
  }, [matchId, compareModel]);

  if (!matchId) return <div className="p-8">Loading...</div>;

  const showPredictionMissing =
    error && primaryModel === "v3-lgbm" && error.includes("Predictions not found");

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <a href="/imports" className="text-blue-600 hover:text-blue-800">
            ← Back to Imports
          </a>
        </div>

        {loading && <div className="text-gray-600">Loading timeline...</div>}
        {error && !showPredictionMissing && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 mb-4">
            Error: {error}
          </div>
        )}

        {showPredictionMissing && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-yellow-800 mb-4">
            <p className="font-semibold">Predictions not yet computed for {primaryModel}</p>
            <p className="text-sm mt-2">
              Run: <code className="bg-yellow-100 px-2 py-1 rounded">npm run predict:match -- {primary?.match.sourceMatchId}</code>
            </p>
          </div>
        )}

        {primary && (
          <>
            {/* Header */}
            <div className="bg-white rounded shadow p-6 mb-6">
              <h1 className="text-3xl font-bold mb-2">
                {primary.match.teamA} vs {primary.match.teamB}
              </h1>
              <p className="text-gray-600">
                Total balls: {primary.match.ballCount} | Timeline points: {primary.timeline.length}
              </p>
            </div>

            {/* Model Selection & Toggles */}
            <div className="bg-white rounded shadow p-4 mb-6">
              <div className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="font-semibold">Primary:</label>
                    <select
                      value={primaryModel}
                      onChange={(e) => setPrimaryModel(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded"
                    >
                      <option value="v0">v0</option>
                      <option value="v1">v1</option>
                      <option value="v3-lgbm">v3-lgbm</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="font-semibold">Compare:</label>
                    <select
                      value={compareModel || ""}
                      onChange={(e) => setCompareModel(e.target.value || null)}
                      className="px-3 py-2 border border-gray-300 rounded"
                    >
                      <option value="">None</option>
                      <option value="v0">v0</option>
                      <option value="v1">v1</option>
                      <option value="v3-lgbm">v3-lgbm</option>
                    </select>
                    {compareLoading && <span className="text-sm text-gray-500">Loading...</span>}
                  </div>

                  <label className="flex items-center gap-2 ml-auto">
                    <input
                      type="checkbox"
                      checked={showWickets}
                      onChange={(e) => setShowWickets(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Show Wickets</span>
                  </label>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-blue-600"></div>
                    <span>{primaryModel}</span>
                  </div>
                  {compare && (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-green-600"></div>
                      <span>{compareModel}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded shadow p-6 mb-6 grid grid-cols-2 gap-6 md:grid-cols-4">
              <div>
                <div className="text-gray-600 text-sm">1st Innings Runs</div>
                <div className="text-2xl font-bold">{primary.summary.firstInningsRuns || 0}</div>
                <div className="text-sm text-gray-500">
                  {primary.summary.firstInningsWickets || 0} wickets
                </div>
              </div>
              {primary.summary.secondInningsTarget && (
                <>
                  <div>
                    <div className="text-gray-600 text-sm">Target</div>
                    <div className="text-2xl font-bold">{primary.summary.secondInningsTarget}</div>
                  </div>
                  <div>
                    <div className="text-gray-600 text-sm">2nd Innings Runs</div>
                    <div className="text-2xl font-bold">
                      {primary.summary.secondInningsRuns || 0}
                    </div>
                    <div className="text-sm text-gray-500">
                      {primary.summary.secondInningsWickets || 0} wickets
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-600 text-sm">Result</div>
                    <div className="text-lg font-bold capitalize">
                      {primary.summary.result || "Unknown"}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Chart */}
            <div className="bg-white rounded shadow p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4">Team A Win Probability</h2>
              <ChartComponent
                primaryTimeline={primary.timeline}
                compareTimeline={compare?.timeline || null}
                primaryModel={primaryModel}
                compareModel={compareModel}
                hoveredBall={hoveredBall}
                onHover={setHoveredBall}
                showWickets={showWickets}
              />
            </div>

            {/* Key Events */}
            <div className="bg-white rounded shadow p-6">
              <h2 className="text-2xl font-bold mb-4">Key Events</h2>
              <EventsList timeline={primary.timeline} hoveredBall={hoveredBall} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface ChartProps {
  primaryTimeline: TimelinePoint[];
  compareTimeline: TimelinePoint[] | null;
  primaryModel: string;
  compareModel: string | null;
  hoveredBall: number | null;
  onHover: (index: number | null) => void;
  showWickets: boolean;
}

function ChartComponent({
  primaryTimeline,
  compareTimeline,
  primaryModel,
  compareModel,
  hoveredBall,
  onHover,
  showWickets,
}: ChartProps) {
  const width = 1000;
  const height = 400;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const minProb = 0;
  const maxProb = 1;

  // Generate path for primary timeline
  const primaryPath = primaryTimeline
    .map((point, idx) => {
      const x = padding.left + (idx / Math.max(primaryTimeline.length - 1, 1)) * chartWidth;
      const y =
        padding.top +
        chartHeight -
        ((point.teamAWinProb - minProb) / (maxProb - minProb)) * chartHeight;
      return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  // Generate path for compare timeline
  const comparePath =
    compareTimeline &&
    compareTimeline
      .map((point, idx) => {
        const x = padding.left + (idx / Math.max(compareTimeline.length - 1, 1)) * chartWidth;
        const y =
          padding.top +
          chartHeight -
          ((point.teamAWinProb - minProb) / (maxProb - minProb)) * chartHeight;
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="border border-gray-200" onMouseLeave={() => onHover(null)}>
        {/* Grid background */}
        {[0, 0.25, 0.5, 0.75, 1].map((prob) => (
          <g key={`grid-${prob}`}>
            <line
              x1={padding.left}
              y1={padding.top + (1 - prob) * chartHeight}
              x2={width - padding.right}
              y2={padding.top + (1 - prob) * chartHeight}
              stroke="#e5e7eb"
              strokeDasharray="2,2"
            />
            <text
              x={padding.left - 10}
              y={padding.top + (1 - prob) * chartHeight + 4}
              fontSize="12"
              textAnchor="end"
              fill="#6b7280"
            >
              {(prob * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* Innings separator line */}
        {primaryTimeline.length > 1 && (
          <line
            x1={padding.left + (primaryTimeline.length / 2 / primaryTimeline.length) * chartWidth}
            y1={padding.top}
            x2={padding.left + (primaryTimeline.length / 2 / primaryTimeline.length) * chartWidth}
            y2={height - padding.bottom}
            stroke="#d1d5db"
            strokeDasharray="4,4"
            opacity="0.5"
          />
        )}

        {/* Primary timeline line */}
        <path d={primaryPath} stroke="#2563eb" strokeWidth="2" fill="none" />

        {/* Compare timeline line */}
        {comparePath && <path d={comparePath} stroke="#16a34a" strokeWidth="2" fill="none" />}

        {/* Wicket markers */}
        {showWickets &&
          primaryTimeline.map((point, idx) => {
            if (!point.isWicket) return null;
            const x = padding.left + (idx / Math.max(primaryTimeline.length - 1, 1)) * chartWidth;
            const y =
              padding.top +
              chartHeight -
              ((point.teamAWinProb - minProb) / (maxProb - minProb)) * chartHeight;
            return (
              <circle
                key={`wicket-${idx}`}
                cx={x}
                cy={y}
                r="4"
                fill="#dc2626"
                opacity="0.7"
              />
            );
          })}

        {/* Interactive hover overlay */}
        {primaryTimeline.map((point, idx) => {
          const x = padding.left + (idx / Math.max(primaryTimeline.length - 1, 1)) * chartWidth;
          return (
            <rect
              key={`hover-${idx}`}
              x={x - 5}
              y={padding.top}
              width="10"
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => onHover(idx)}
            />
          );
        })}

        {/* Axes */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#000"
          strokeWidth="1"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="#000"
          strokeWidth="1"
        />

        {/* Tooltip */}
        {hoveredBall !== null && primaryTimeline[hoveredBall] && (
          <Tooltip
            point={primaryTimeline[hoveredBall]}
            idx={hoveredBall}
            totalPoints={primaryTimeline.length}
            width={width}
            height={height}
            padding={padding}
            chartWidth={chartWidth}
            chartHeight={chartHeight}
          />
        )}
      </svg>
    </div>
  );
}

interface TooltipProps {
  point: TimelinePoint;
  idx: number;
  totalPoints: number;
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  chartWidth: number;
  chartHeight: number;
}

function Tooltip({
  point,
  idx,
  totalPoints,
  width,
  height,
  padding,
  chartWidth,
  chartHeight,
}: TooltipProps) {
  const x = padding.left + (idx / Math.max(totalPoints - 1, 1)) * chartWidth;
  const y =
    padding.top + chartHeight - (point.teamAWinProb * chartHeight);

  let tooltipX = x + 15;
  let tooltipY = y + 15;

  if (tooltipX + 150 > width) {
    tooltipX = x - 165;
  }

  return (
    <g>
      <circle cx={x} cy={y} r="4" fill="#2563eb" />
      <rect x={tooltipX} y={tooltipY} width="150" height="80" fill="white" stroke="#999" rx="4" />
      <text x={tooltipX + 10} y={tooltipY + 20} fontSize="12" fontWeight="bold">
        {point.over}.{point.ballInOver} (Ball {point.legalBallNumber || idx + 1})
      </text>
      <text x={tooltipX + 10} y={tooltipY + 35} fontSize="12">
        Win%: {(point.teamAWinProb * 100).toFixed(1)}%
      </text>
      <text x={tooltipX + 10} y={tooltipY + 50} fontSize="12">
        Score: {point.runs}/{point.wickets}
      </text>
      <text x={tooltipX + 10} y={tooltipY + 65} fontSize="12">
        {point.ballOutcome || 0} {point.isWicket ? "W" : ""} {point.isSix ? "6" : ""}{" "}
        {point.isFour ? "4" : ""}
      </text>
    </g>
  );
}

function EventsList({ timeline, hoveredBall }: { timeline: TimelinePoint[]; hoveredBall: number | null }) {
  const wickets = timeline.filter((p) => p.isWicket);
  const fours = timeline.filter((p) => p.isFour);
  const sixes = timeline.filter((p) => p.isSix);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div>
        <h3 className="font-bold text-red-600 mb-2">Wickets ({wickets.length})</h3>
        <ul className="space-y-1 text-sm">
          {wickets.slice(0, 10).map((point, idx) => (
            <li key={idx} className="text-gray-700">
              {point.over}.{point.ballInOver}: {point.runs}/{point.wickets}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-blue-600 mb-2">Fours ({fours.length})</h3>
        <ul className="space-y-1 text-sm">
          {fours.slice(0, 10).map((point, idx) => (
            <li key={idx} className="text-gray-700">
              {point.over}.{point.ballInOver}: {point.runs} runs
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-purple-600 mb-2">Sixes ({sixes.length})</h3>
        <ul className="space-y-1 text-sm">
          {sixes.slice(0, 10).map((point, idx) => (
            <li key={idx} className="text-gray-700">
              {point.over}.{point.ballInOver}: {point.runs} runs
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


