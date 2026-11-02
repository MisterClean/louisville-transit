import { useMemo } from 'react';
import { buildDailyTrend } from '../lib/aggregate.js';

const WIDTH = 120;
const HEIGHT = 28;
const PAD_X = 1; // keeps the stroke from clipping at the SVG edges
const PAD_Y = 2;

// Trend label: green when recent 7d is materially below prior 7d (incidents
// trending down = good), red when materially above. Within ±5% reads as
// "flat" — that band keeps day-to-day noise from flipping the indicator
// constantly.
function trendBand(ratio) {
  if (ratio == null) return null;
  if (ratio < 0.95) return 'down';
  if (ratio > 1.05) return 'up';
  return 'flat';
}

function trendArrow(band) {
  if (band === 'up') return '↗';
  if (band === 'down') return '↘';
  if (band === 'flat') return '→';
  return null;
}

function trendColorClass(band) {
  if (band === 'up') return 'text-red-500';
  if (band === 'down') return 'text-green-600 dark:text-green-500';
  return 'text-slate-500 dark:text-slate-400';
}

function trendLabel(ratio, band) {
  if (band == null) return null;
  if (band === 'flat') return 'flat vs prior 7 days';
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  return `${pct}% ${band === 'up' ? 'higher' : 'lower'} vs prior 7 days`;
}

export default function TrendSparkline({ alerts, observations, trend, reserveLabel = false }) {
  // Accept a precomputed trend from the parent (SummaryStats lifts the
  // computation so the WoW callout sentence and the sparkline share a single
  // source of truth) but stay independently usable when no parent provides it.
  const computed = useMemo(
    () => (trend ? null : buildDailyTrend(alerts, observations)),
    [alerts, observations, trend],
  );
  const { avg, trendRatio, recent7Avg, prior7Avg } = trend ?? computed;

  // No incidents anywhere in the window → render nothing rather than a flat
  // line at zero, which reads as "broken" more than "great".
  const max = Math.max(...avg, 0);
  if (max === 0) return null;

  const stepX = (WIDTH - 2 * PAD_X) / (avg.length - 1);
  const points = avg.map((v, i) => {
    const x = PAD_X + i * stepX;
    const y = HEIGHT - PAD_Y - (v / max) * (HEIGHT - 2 * PAD_Y);
    return [x, y];
  });
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  // Fill underneath the line for a hint of magnitude — closes the path back
  // to the baseline so a polygon can be filled.
  const areaPath = `${linePath} L${(PAD_X + (avg.length - 1) * stepX).toFixed(1)},${HEIGHT - PAD_Y} L${PAD_X.toFixed(1)},${HEIGHT - PAD_Y} Z`;

  const band = trendBand(trendRatio);
  const arrow = trendArrow(band);
  const label = trendLabel(trendRatio, band);
  const titleParts = [
    `Last 30 days, 7-day rolling average.`,
    `Most recent 7 days: ${recent7Avg.toFixed(1)}/day.`,
    prior7Avg > 0 ? `Prior 7 days: ${prior7Avg.toFixed(1)}/day.` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-2 flex-shrink-0" title={titleParts.join(' ')}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`30-day incident trend: ${label ?? 'no baseline'}`}
      >
        <path d={areaPath} fill="rgba(100, 116, 139, 0.15)" />
        <path
          d={linePath}
          fill="none"
          stroke="rgb(100, 116, 139)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* When `reserveLabel` is set, always render a fixed-width label slot
          so a column of sparklines stays aligned even on rows without a
          prior-window baseline. Without that prop, the label only renders
          when there's a band (legacy inline behavior — keeps single-shot
          callers like SummaryStats unchanged). */}
      {reserveLabel ? (
        <span
          className={`text-xs font-medium tabular-nums w-12 text-left ${arrow ? trendColorClass(band) : 'text-slate-300 dark:text-slate-600'}`}
        >
          {arrow ? (
            <>
              {arrow}
              {band !== 'flat' && (
                <span className="ml-0.5">{Math.round(Math.abs(trendRatio - 1) * 100)}%</span>
              )}
            </>
          ) : (
            <span title="No incidents in the prior 7-day window to compare against.">N/A</span>
          )}
        </span>
      ) : (
        arrow && (
          <span className={`text-xs font-medium tabular-nums ${trendColorClass(band)}`}>
            {arrow}
            {band !== 'flat' && (
              <span className="ml-0.5">{Math.round(Math.abs(trendRatio - 1) * 100)}%</span>
            )}
          </span>
        )
      )}
    </div>
  );
}
