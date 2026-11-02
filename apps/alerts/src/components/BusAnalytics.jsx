import { useEffect, useState } from 'react';
import { dataUrl } from '../lib/dataSource.js';

export default function BusAnalytics({ route = null }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    fetch(dataUrl('analytics.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!data) return null;
  const matches = (r) => !route || String(r) === String(route);
  const speeds = (data.speedmaps || [])
    .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
    .filter((entry) => matches(entry.route));
  const crowding = (data.crowding_rollup || []).filter((entry) => matches(entry.route));
  const headways = (data.headways || []).filter((entry) => matches(entry.route));
  return (
    <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Bus observations</h2>
        <p className="text-xs text-slate-500">
          Recent observations; gaps indicate missing data. Predicted delays are not verified
          arrivals.
        </p>
      </div>
      {!speeds.length && !crowding.length && !headways.length && (
        <p className="text-sm text-slate-500">Collecting observations.</p>
      )}
      {speeds.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Observed speeds by route segment</h3>
          <p className="text-xs text-slate-500">
            Gray: no data · red: under 5 mph · orange: 5–10 · yellow: 10–15 · green: 15 or more.
          </p>
          <div className="space-y-2 mt-2">
            {speeds.map((s) => (
              <div key={s.shapeId}>
                <p className="text-xs text-slate-500">
                  Route {s.route} · {s.summary?.covered ?? 0} of {s.summary?.bins ?? 0} segments
                  observed
                  {Number.isFinite(s.summary?.avg)
                    ? ` · ${s.summary.avg.toFixed(1)} mph average`
                    : ''}
                </p>
                <div
                  className="flex h-3 rounded overflow-hidden"
                  role="img"
                  aria-label={`Route ${s.route} speed segments`}
                >
                  {Object.entries(s.bins).map(([segment, speed]) => (
                    <span
                      key={`${s.shapeId}-${segment}`}
                      className="flex-1"
                      title={speed == null ? 'No data' : `${speed.toFixed(1)} mph`}
                      style={{
                        backgroundColor:
                          speed == null
                            ? '#e2e8f0'
                            : speed < 5
                              ? '#dc2626'
                              : speed < 10
                                ? '#f97316'
                                : speed < 15
                                  ? '#eab308'
                                  : '#16a34a',
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {crowding.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Reported occupancy</h3>
          <ul className="text-sm text-slate-600 dark:text-slate-300">
            {crowding.map((c) => (
              <li key={c.route}>
                Route {c.route}: {Math.round(c.pctCrowded * 100)}% of {c.total} observations
                reported crowded
              </li>
            ))}
          </ul>
        </div>
      )}
      {headways.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Scheduled headways</h3>
          <ul className="text-sm text-slate-600 dark:text-slate-300">
            {headways.map((h) => (
              <li key={h.route}>
                Route {h.route}:{' '}
                {h.directions
                  .filter((d) => d.headway_min != null)
                  .map((d) => `${Math.round(d.headway_min)} min`)
                  .join(' / ') || 'No scheduled service'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!route && data.adherence?.samples?.length > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {data.adherence.samples.length} upcoming stop predictions include delay estimates.
        </p>
      )}
    </section>
  );
}
