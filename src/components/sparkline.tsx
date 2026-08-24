"use client";

/**
 * Mini sparkline (issue #43): last N measurements as a tiny SVG polyline —
 * no chart library needed. Pure presentational, receives the series.
 */

export function Sparkline({
  series,
  color = "var(--success)",
  width = 90,
  height = 24,
}: {
  series: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo || 1;
  const pts = series
    .map((v, i) => `${((i * (width - 4)) / (series.length - 1) + 2).toFixed(1)},${(height - 3 - ((v - lo) / span) * (height - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
