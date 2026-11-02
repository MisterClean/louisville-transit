import { useMemo } from 'react';
import { collectUpcomingCancellations } from '../lib/cancellation.js';
import { formatTime } from '../lib/format.js';
import { normalizeTrainLine, TRAIN_LINES } from '../lib/trainLines.js';

// Forward-looking strip of TARC departures announced as cancelled but not yet
// past their scheduled time — the forward-looking half of the cancellation
// lifecycle (the retrospective view is just "this departure didn't run"). Shown
// on the homepage, the rail line page (one line), and the system-health page
// (all rail lines, with a line pill). Renders nothing when none are upcoming.
//
// TARC analog of cta-alert-history's MetraUpcomingCancellations. TARC carries
// no train number, so each row leads with the scheduled departure time and its
// origin instead. `incidents` are nested incidents; `showLine` adds a per-row
// line pill (homepage / system page, where rows span lines).
export default function MartaUpcomingCancellations({ incidents, now, showLine = false }) {
  const items = useMemo(() => collectUpcomingCancellations(incidents, { now }), [incidents, now]);
  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-500/10 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300 mb-2">
        <span aria-hidden="true">⚠️</span>
        {items.length} upcoming cancellation{items.length === 1 ? '' : 's'}
      </h2>
      <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mb-3">
        Departures TARC has announced won't run, not yet past their scheduled time.
      </p>
      <ul className="space-y-1">
        {items.map((it) => {
          const key = it.line ? normalizeTrainLine(it.line) : null;
          const info = key ? TRAIN_LINES[key] : null;
          return (
            <li key={it.id}>
              <a
                href={`/event/${it.id}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-slate-700 dark:text-slate-200 hover:underline"
              >
                {showLine && info && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: info.color, color: info.textColor }}
                  >
                    {String(key).toUpperCase()}
                  </span>
                )}
                <span className="font-medium">{formatTime(it.departureTs)} departure</span>
                {it.origin && (
                  <span className="text-slate-500 dark:text-slate-400">· {it.origin}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
