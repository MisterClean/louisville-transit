import { useMemo } from 'react';
import { buildSignalsByLine } from '../lib/aggregate.js';
import { observationSignals, SIGNAL_LABELS, SIGNAL_TYPES } from '../lib/incidents.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/trainLines.js';

// Distinct, accessible colors for each signal category. Tied to the
// disruption "feel" — gap/ghost (absence) sit cool, bunching (excess) sits
// warm, pulse subtypes sit muted to read as a related family.
const SIGNAL_COLORS = {
  gap: '#0ea5e9', // sky-500
  bunching: '#f97316', // orange-500
  ghost: '#6366f1', // indigo-500
  cancellation: '#ef4444', // red-500 — service removed outright, the most severe cut
  'pulse-cold': '#94a3b8', // slate-400
  'pulse-held': '#64748b', // slate-500
  'thin-gap': '#8b5cf6', // violet-500 — most extreme absence (whole route silent)
};

function lineTotal(counts = {}, types = SIGNAL_TYPES) {
  return types.reduce((sum, sig) => sum + (counts[sig] || 0), 0);
}

// One stacked-bar row in the signal-mix chart. Reused by the all-trains
// homepage chart and the single-route bus pages — same visual, scoped data.
function SignalBar({
  labelText,
  labelColor,
  counts,
  total,
  ariaPrefix,
  types = SIGNAL_TYPES,
  colors = SIGNAL_COLORS,
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-12 flex-shrink-0 text-right">
        <span className="text-xs font-semibold" style={{ color: labelColor }}>
          {labelText}
        </span>
      </div>
      <div
        className="flex-1 flex h-4 rounded-sm overflow-hidden bg-slate-100 dark:bg-gh-subtle"
        role="img"
        aria-label={`${ariaPrefix}: ${types
          .map((s) => `${counts[s] || 0} ${SIGNAL_LABELS[s]}`)
          .filter((part) => !part.startsWith('0 '))
          .join(', ')}`}
      >
        {types.map((sig) => {
          const c = counts[sig] || 0;
          if (c === 0) return null;
          const pct = (c / total) * 100;
          return (
            <div
              key={sig}
              title={`${SIGNAL_LABELS[sig]}: ${c} (${Math.round(pct)}%)`}
              style={{ width: `${pct}%`, backgroundColor: colors[sig] }}
            />
          );
        })}
      </div>
      <div className="w-10 text-right flex-shrink-0">
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{total}</span>
      </div>
    </div>
  );
}

function SignalLegend({ types = SIGNAL_TYPES, colors = SIGNAL_COLORS }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4 pt-3 border-t border-slate-100 dark:border-gh-border">
      {types.map((sig) => (
        <div key={sig} className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[sig] }} />
          <span className="text-xs text-slate-500 dark:text-slate-400">{SIGNAL_LABELS[sig]}</span>
        </div>
      ))}
    </div>
  );
}

// Build a flat `{ signalKey: count }` tally for an arbitrary observation
// list. Mirrors the per-line bookkeeping in `buildSignalsByLine` but for
// one arbitrary cohort — used by the single-row bus-route variant below.
function tallySignals(observations) {
  const counts = {};
  for (const sig of SIGNAL_TYPES) counts[sig] = 0;
  for (const o of observations || []) {
    for (const sig of observationSignals(o)) {
      if (sig in counts) counts[sig] += 1;
    }
  }
  return counts;
}

// The default homepage variant: one row per train line, hidden when no
// signals fired anywhere in the dataset. Bus routes are excluded because
// there are too many to chart usefully at the system level — single bus
// routes get the dedicated `<SignalBreakdown.SingleRoute>` variant below.
export default function SignalBreakdown({ observations }) {
  const { byLine, totals } = useMemo(() => buildSignalsByLine(observations), [observations]);

  const linesWithData = TRAIN_LINE_ORDER.filter((line) => lineTotal(byLine[line]) > 0);
  const grandTotal = SIGNAL_TYPES.reduce((s, sig) => s + (totals[sig] || 0), 0);

  // Nothing in the rail observations -> render nothing (keeps the homepage quiet).
  if (grandTotal === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Signal mix by rail line
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="space-y-2">
          {linesWithData.map((line) => {
            const info = TRAIN_LINES[line];
            const counts = byLine[line];
            const total = lineTotal(counts);
            return (
              <SignalBar
                key={line}
                labelText={info.label}
                labelColor={info.color}
                counts={counts}
                total={total}
                ariaPrefix={`${info.label} Line`}
              />
            );
          })}
        </div>
        <SignalLegend />
      </div>
    </section>
  );
}

// Single-row variant for /route/:id pages. The route is already locked, so
// just one bar and the same legend. Hidden when the route has no signals
// to break down (e.g. a bus route that only has official alerts but no bot
// observations yet).
export function SignalBreakdownSingleRoute({ observations, label, labelColor }) {
  const counts = useMemo(() => tallySignals(observations), [observations]);
  const total = lineTotal(counts);
  if (total === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Signal mix
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <SignalBar
          labelText={label}
          labelColor={labelColor}
          counts={counts}
          total={total}
          ariaPrefix={label}
        />
        <SignalLegend />
      </div>
    </section>
  );
}
