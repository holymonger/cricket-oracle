"use client";

interface WinProbChartProps {
  snapshots: Array<{
    timestamp: number;
    winProb: number;
  }>;
}

export default function WinProbChart({ snapshots }: WinProbChartProps) {
  if (snapshots.length < 2) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-gray-50 border rounded text-gray-500">
        Save at least 2 snapshots to see the chart.
      </div>
    );
  }

  // Chart dimensions
  const width = 600;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate points
  const points = snapshots.map((snap, idx) => {
    const x = padding.left + (idx / (snapshots.length - 1)) * chartWidth;
    const y = padding.top + (1 - snap.winProb) * chartHeight; // invert Y for SVG coords
    return { x, y, ...snap };
  });

  // Create SVG path for line
  const linePath = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // Format time helper
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="w-full bg-white border rounded p-4">
      <h3 className="text-sm font-semibold mb-4">Win Probability Over Time</h3>
      <svg width={width} height={height} className="border border-gray-200 rounded bg-gray-50">
        {/* Y-axis labels (0%, 25%, 50%, 75%, 100%) */}
        {[0, 25, 50, 75, 100].map((label) => {
          const y = padding.top + ((100 - label) / 100) * chartHeight;
          return (
            <g key={`y-${label}`}>
              <line x1={padding.left - 5} y1={y} x2={padding.left} y2={y} stroke="#ccc" strokeWidth="1" />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#666"
              >
                {label}%
              </text>
            </g>
          );
        })}

        {/* Y-axis line */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="#333"
          strokeWidth="1"
        />

        {/* X-axis line */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#333"
          strokeWidth="1"
        />

        {/* Grid lines (horizontal) */}
        {[25, 50, 75].map((label) => {
          const y = padding.top + ((100 - label) / 100) * chartHeight;
          return (
            <line
              key={`grid-${label}`}
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#eee"
              strokeWidth="1"
            />
          );
        })}

        {/* Line path */}
        <path d={linePath} stroke="#3b82f6" strokeWidth="2" fill="none" />

        {/* Data points (dots) */}
        {points.map((point, idx) => (
          <circle
            key={`dot-${idx}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#3b82f6"
            stroke="white"
            strokeWidth="2"
            style={{ cursor: "pointer" }}
          >
            <title>{`${formatTime(point.timestamp)}: ${(point.winProb * 100).toFixed(1)}%`}</title>
          </circle>
        ))}

        {/* X-axis labels (first, middle, last) */}
        {points.map((point, idx) => {
          if (idx === 0 || idx === points.length - 1 || idx === Math.floor(points.length / 2)) {
            return (
              <text
                key={`x-label-${idx}`}
                x={point.x}
                y={height - padding.bottom + 20}
                textAnchor="middle"
                fontSize="12"
                fill="#666"
              >
                {formatTime(point.timestamp)}
              </text>
            );
          }
        })}
      </svg>
      <div className="mt-2 text-xs text-gray-500 text-center">
        Hover over dots for details
      </div>
    </div>
  );
}
