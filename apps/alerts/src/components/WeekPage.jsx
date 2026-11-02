import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { buildWeekSummary, weekStartUTC } from '../lib/aggregate.js';
import { weekTrail } from '../lib/breadcrumbs.js';
import { formatBusRoute } from '../lib/busRoutes.js';
import {
  atlantaDayIsoUTC,
  atlantaDayUTC,
  formatAtlantaDay,
  formatDuration,
  formatWeekRange,
} from '../lib/format.js';
import { loadIndex, loadRange } from '../lib/incidentStore.js';
import { incidentLifecycle, incidentRecords } from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import { TRAIN_LINES } from '../lib/trainLines.js';
import { dayStringToUtc } from '../lib/urlState.js';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import IncidentList from './IncidentList.jsx';
import NotFoundPage from './NotFoundPage.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// `/week` (current week) and `/week/:date` — a recap of one Sun–Sat week.
// Part of the browsable weekly archive: each completed week is a permalink
// (the URL's date is the week's Sunday). Strictly descriptive — counts, a
// per-day breakdown, most-affected lines, the longest incident, and a plain
// week-over-week delta. No scoring or commentary.
export default function WeekPage({ weekParam }) {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Resolve the URL param to the Sunday of its week. No param → current week.
  // An invalid date string → null (renders not-found without fetching). Any
  // day in a week normalizes to that week's Sunday, so /week/2026-05-20 (a
  // Wednesday) still resolves to the week starting 2026-05-17.
  const weekStartUtc = useMemo(() => {
    if (weekParam == null) return weekStartUTC(atlantaDayUTC(now));
    const dayUtc = dayStringToUtc(weekParam);
    return dayUtc == null ? null : weekStartUTC(dayUtc);
  }, [weekParam, now]);

  const isFuture = weekStartUtc != null && weekStartUtc > weekStartUTC(atlantaDayUTC(now));
  const rangeLabel = weekStartUtc != null ? formatWeekRange(weekStartUtc, { year: true }) : null;

  useEffect(() => {
    if (weekStartUtc == null) return;
    let alive = true;
    // Union the month shards overlapping this week plus the prior week (the
    // week-over-week delta compares against the week before). The index supplies
    // generated_at for the Header / data_start_ts.
    Promise.all([loadRange(weekStartUtc - WEEK_MS, weekStartUtc + 7 * DAY_MS), loadIndex()])
      .then(([incidents, index]) => {
        if (!alive) return;
        setData({
          incidents,
          generated_at: index.generated_at,
          data_start_ts: index.data_start_ts ?? null,
          coverage: index.coverage ?? null,
        });
      })
      .catch(setError);
    return () => {
      alive = false;
    };
  }, [weekStartUtc]);

  const flat = useMemo(() => (data ? incidentRecords(data.incidents) : null), [data]);

  const summary = useMemo(() => {
    if (!flat || weekStartUtc == null) return null;
    return buildWeekSummary(flat.officialRecords, flat.detectionRecords, weekStartUtc, now, {
      dataStartTs: data?.data_start_ts ?? null,
      coverageDays: data?.coverage?.complete_days ?? [],
    });
  }, [flat, weekStartUtc, now, data?.data_start_ts, data?.coverage?.complete_days]);

  // Incidents that started in this week, newest first — the list under the
  // recap. Same start-in-week predicate (in atlantaDayUTC space) as the
  // summary, so the list length matches the headline count.
  const weekIncidents = useMemo(() => {
    if (!data || weekStartUtc == null) return [];
    const end = weekStartUtc + 6 * DAY_MS;
    return data.incidents
      .filter((inc) => {
        const ts = incidentLifecycle(inc).first_seen_ts;
        if (ts == null) return false;
        const d = atlantaDayUTC(ts);
        return d >= weekStartUtc && d <= end;
      })
      .sort((a, b) => incidentLifecycle(b).first_seen_ts - incidentLifecycle(a).first_seen_ts);
  }, [data, weekStartUtc]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.officialRecords, flat.detectionRecords, { now, windowDays: 90 });
  }, [flat, now]);

  useEffect(() => {
    const base = 'Louisville Transit Alerts';
    if (!rangeLabel) {
      document.title = base;
      return;
    }
    document.title = `Week of ${rangeLabel} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [rangeLabel]);

  if (weekStartUtc == null) return <NotFoundPage />;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  // Neighbor weeks. Next is hidden when it'd land in a future week.
  const prevIso = atlantaDayIsoUTC(weekStartUtc - WEEK_MS);
  const nextWeekStart = weekStartUtc + WEEK_MS;
  const nextIso = atlantaDayIsoUTC(nextWeekStart);
  const showNext = nextWeekStart <= weekStartUTC(atlantaDayUTC(now));

  const maxDayCount = summary ? Math.max(1, ...summary.perDay.map((d) => d.count)) : 1;

  // Week-over-week delta — only voiced when the prior week had real volume, so
  // a 1→2 swing doesn't read as "+100%". Mirrors SummaryStats' gating.
  let wow = null;
  if (summary && summary.priorTotal >= 3) {
    const delta = summary.total - summary.priorTotal;
    const pct = Math.round((Math.abs(delta) / summary.priorTotal) * 100);
    if (pct >= 10) wow = { up: delta > 0, pct };
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={data?.generated_at}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
        alerts={flat?.alerts}
        observations={flat?.observations}
      />
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full flex-1">
        <div>
          <Breadcrumb items={weekTrail(weekStartUtc)} className="mb-3" />
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              Week of {rangeLabel}
            </h1>
            {summary?.isCurrent && (
              <span className="text-sm text-slate-500 dark:text-slate-400">in progress</span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Sunday–Saturday recap · incidents that started this week.
          </p>
        </div>

        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-40 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {isFuture && data && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            This week is in the future — nothing on record yet.
          </div>
        )}

        {data && !summary && !isFuture && (
          <p className="text-sm text-slate-500">
            Observation coverage does not include this full week. Unobserved days are unknown; the
            incident list below contains only collected records.
          </p>
        )}
        {summary &&
          !isFuture &&
          (summary.total === 0 ? (
            <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
              No incidents started this week.
            </div>
          ) : (
            <>
              {/* Headline recap sentence */}
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <strong className="text-slate-800 dark:text-slate-100">{summary.total}</strong>{' '}
                incident{summary.total === 1 ? '' : 's'}
                {summary.lineCount > 0 && (
                  <>
                    {' '}
                    across{' '}
                    <strong className="text-slate-800 dark:text-slate-100">
                      {summary.lineCount}
                    </strong>{' '}
                    line{summary.lineCount === 1 ? '' : 's'} &amp; route
                    {summary.lineCount === 1 ? '' : 's'}
                  </>
                )}
                {' · '}
                {summary.trainCount} train · {summary.busCount} bus
                {wow && (
                  <>
                    {' · '}
                    <strong
                      className={wow.up ? 'text-red-500' : 'text-green-600 dark:text-green-500'}
                    >
                      {wow.pct}% {wow.up ? 'more' : 'fewer'}
                    </strong>{' '}
                    than the prior week
                  </>
                )}
                {!wow && summary.priorTotal > 0 && (
                  <span className="text-slate-400 dark:text-slate-500">
                    {' '}
                    (prior week: {summary.priorTotal})
                  </span>
                )}
              </p>

              {/* Per-day breakdown — one bar per Sun–Sat day, linked to that
                    day's page. Busiest day gets the darker fill. */}
              <section>
                <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  By day
                </h2>
                <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
                  <div className="flex items-end justify-between gap-2 h-24">
                    {summary.perDay.map((d, i) => {
                      const isBusiest =
                        summary.busiestDay && d.dayUtc === summary.busiestDay.dayUtc;
                      const h = Math.round((d.count / maxDayCount) * 100);
                      return (
                        <a
                          key={d.dayUtc}
                          href={`/day/${atlantaDayIsoUTC(d.dayUtc)}`}
                          className="flex-1 flex flex-col items-center justify-end h-full group"
                          title={`${formatAtlantaDay(d.dayUtc)}: ${d.count} incident${d.count === 1 ? '' : 's'}`}
                        >
                          <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400 mb-0.5">
                            {d.count > 0 ? d.count : ''}
                          </span>
                          <div
                            className={`w-full rounded-t-sm transition-colors ${
                              isBusiest
                                ? 'bg-slate-600 dark:bg-slate-300'
                                : 'bg-slate-300 dark:bg-gh-border group-hover:bg-slate-400 dark:group-hover:bg-slate-500'
                            }`}
                            style={{ height: `${Math.max(d.count > 0 ? 6 : 2, h)}%` }}
                          />
                          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1">
                            {DAY_LETTERS[i]}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                  {summary.busiestDay && summary.busiestDay.count > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-gh-border">
                      Busiest day:{' '}
                      <a
                        href={`/day/${atlantaDayIsoUTC(summary.busiestDay.dayUtc)}`}
                        className="text-blue-500 hover:text-blue-400 hover:underline"
                      >
                        <strong>{formatAtlantaDay(summary.busiestDay.dayUtc)}</strong>
                      </a>{' '}
                      ({summary.busiestDay.count} incident
                      {summary.busiestDay.count === 1 ? '' : 's'})
                    </p>
                  )}
                </div>
              </section>

              {/* Most-affected lines & routes */}
              {summary.mostAffected.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                    Most affected
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.mostAffected.slice(0, 8).map((m) => {
                      if (m.kind === 'train') {
                        const info = TRAIN_LINES[m.id];
                        if (!info) return null;
                        return (
                          <a
                            key={`train:${m.id}`}
                            href={`/line/${m.id}`}
                            className="inline-flex items-center gap-1.5 min-h-[24px] px-2 py-0.5 rounded-full text-xs font-bold hover:opacity-80 transition-opacity"
                            style={{ backgroundColor: info.color, color: info.textColor }}
                          >
                            {info.label}
                            <span className="tabular-nums opacity-80">{m.count}</span>
                          </a>
                        );
                      }
                      return (
                        <a
                          key={`bus:${m.id}`}
                          href={`/route/${m.id}`}
                          className="inline-flex items-center gap-1.5 min-h-[24px] px-2 py-0.5 rounded-full text-xs font-bold bg-slate-500 text-white hover:opacity-80 transition-opacity"
                        >
                          {formatBusRoute(m.id)}
                          <span className="tabular-nums opacity-80">{m.count}</span>
                        </a>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Longest incident of the week */}
              {summary.longest && (
                <section>
                  <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                    Longest incident
                  </h2>
                  <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border px-4 py-3 text-sm">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {formatDuration(summary.longest.durationMs)}
                    </span>
                    {summary.longest.active && (
                      <span className="text-red-500 font-semibold"> · still active</span>
                    )}
                    {summary.longest.headline && (
                      <span className="text-slate-600 dark:text-slate-300">
                        {' — '}
                        {summary.longest.id ? (
                          <a
                            href={`/event/${summary.longest.id}`}
                            className="text-blue-500 hover:text-blue-400 hover:underline"
                          >
                            {summary.longest.headline}
                          </a>
                        ) : (
                          summary.longest.headline
                        )}
                      </span>
                    )}
                  </div>
                </section>
              )}

              <section>
                <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  All incidents this week
                </h2>
                <IncidentList
                  incidents={weekIncidents}
                  search=""
                  onSearchChange={null}
                  stationIndex={stationIndex}
                  isFiltered
                />
              </section>
            </>
          ))}

        {data && (
          <div className="flex justify-between items-center text-sm pt-2">
            <a
              href={`/week/${prevIso}`}
              className="text-blue-500 hover:text-blue-400 hover:underline"
            >
              ← Previous week
            </a>
            {showNext ? (
              <a
                href={`/week/${nextIso}`}
                className="text-blue-500 hover:text-blue-400 hover:underline"
              >
                Next week →
              </a>
            ) : (
              <span />
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
