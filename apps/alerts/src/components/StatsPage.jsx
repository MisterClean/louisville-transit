import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import {
  computeRestorationDeltas,
  computeSegmentRecurrence,
  computeStatsLeaderboards,
  hasWindowCoverage,
} from '../lib/aggregate.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { formatAtlantaDay, formatDate, formatDuration, formatTime } from '../lib/format.js';
import { loadAggregates, loadRecent } from '../lib/incidentStore.js';
import { formatRoutesLabel, incidentRecords } from '../lib/incidents.js';
import { TRAIN_LINES } from '../lib/trainLines.js';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function formatHour(h) {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function StatCard({ eyebrow, headline, sub, href }) {
  // Same card frame regardless of metric — keeps the page rhythmically
  // similar to the homepage stack rather than introducing a new visual
  // language. `href` makes the headline a deep link when there's a
  // sensible target; otherwise the card is plain text.
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
        {eyebrow}
      </p>
      <p className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-snug">
        {headline}
      </p>
      {sub && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{sub}</p>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
      >
        {body}
      </a>
    );
  }
  return (
    <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
      {body}
    </div>
  );
}

function RestorationDeltaList({ title, subtitle, rows }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
          {title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{subtitle}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
          No incidents in this direction.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border">
      <div className="p-4 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-gh-border">
        {rows.map((row) => {
          const absMs = Math.abs(row.deltaMs);
          const routesLabel = formatRoutesLabel(row.kind, row.routes);
          return (
            <a
              key={row.id}
              href={`/event/${row.id}`}
              className="block px-4 py-2 hover:bg-slate-50 dark:hover:bg-gh-canvas transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {routesLabel}
                </span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                  {formatDuration(absMs)}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {formatAtlantaDay(row.firstSeenTs)} · {row.headline ?? 'Bot-corroborated incident'}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [aggregates, setAggregates] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Every leaderboard on this page is ≤90-day-windowed, so the recent slice
    // covers them; YoY is the one >90d computation and reads the precomputed
    // aggregates instead of the full history.
    loadRecent().then(setData).catch(setError);
    loadAggregates()
      .then(setAggregates)
      .catch(() => {}); // YoY is a non-critical enhancement; degrade quietly
  }, []);

  useEffect(() => {
    document.title = 'Stats · Louisville Transit Alerts';
    return () => {
      document.title = 'Louisville Transit Alerts';
    };
  }, []);

  // Analytics here read incident-derived official/detection records.
  const flat = useMemo(() => (data ? incidentRecords(data.incidents) : null), [data]);

  const leaders = useMemo(() => {
    if (!flat) return null;
    return computeStatsLeaderboards(flat.officialRecords, flat.detectionRecords, {
      now,
      windowDays: 90,
      dataStartTs: data?.data_start_ts ?? null,
      coverageDays: data?.coverage?.complete_days ?? [],
    });
  }, [flat, now, data?.data_start_ts, data?.coverage?.complete_days]);

  const segments = useMemo(() => {
    if (!flat) return [];
    return computeSegmentRecurrence(flat.detectionRecords, {
      now,
      windowDays: 90,
      dataStartTs: data?.data_start_ts ?? null,
      coverageDays: data?.coverage?.complete_days ?? [],
      limit: 5,
    });
  }, [flat, now, data?.data_start_ts, data?.coverage?.complete_days]);

  // YoY needs a year of history, so it's precomputed server-side (overall,
  // here) rather than derived from the 93-day recent slice.
  const yoy =
    hasWindowCoverage(data?.data_start_ts, 30, now, data?.coverage?.complete_days ?? []) &&
    hasWindowCoverage(
      data?.data_start_ts,
      30,
      now - 365 * 86400000,
      data?.coverage?.complete_days ?? [],
    )
      ? (aggregates?.yoy?.overall ?? null)
      : null;

  const restorationDeltas = useMemo(() => {
    if (!flat) return null;
    return computeRestorationDeltas(flat.officialRecords, flat.detectionRecords, {
      now,
      windowDays: 90,
      dataStartTs: data?.data_start_ts ?? null,
      coverageDays: data?.coverage?.complete_days ?? [],
      limit: 3,
    });
  }, [flat, now, data?.data_start_ts, data?.coverage?.complete_days]);

  const longestRoutesLabel = useMemo(() => {
    if (!leaders?.longestIncident) return null;
    return formatRoutesLabel(leaders.longestIncident.kind, leaders.longestIncident.routes);
  }, [leaders]);

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
      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-6 space-y-4 w-full flex-1">
        <div>
          <Breadcrumb items={topLevelTrail('Stats')} className="mb-3" />
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stats</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Worst days, hours, stations, and longest incidents on record.
          </p>
        </div>

        {error && <p className="text-red-600 text-sm">Failed to load stats data.</p>}

        {!error && !data && (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                key={i}
                className="h-20 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border"
              />
            ))}
          </div>
        )}

        {yoy?.enoughData && (
          <StatCard
            eyebrow="Year-over-year (last 30 days)"
            headline={
              yoy.pctChange == null
                ? `${yoy.currentCount} incidents — no comparable activity a year ago`
                : `${yoy.currentCount} incidents — ${
                    yoy.pctChange === 0
                      ? 'unchanged from'
                      : `${Math.abs(Math.round(yoy.pctChange * 100))}% ${
                          yoy.pctChange > 0 ? 'busier than' : 'quieter than'
                        }`
                  } the same window last year (${yoy.priorCount})`
            }
            sub="Trailing 30 days vs the same 30-day window 365 days ago. Counts merged incidents (alerts + bot observations together)."
          />
        )}

        {data &&
          !hasWindowCoverage(data.data_start_ts, 90, now, data?.coverage?.complete_days ?? []) && (
            <p className="text-sm text-slate-500">
              Collecting history. Full-period rankings are unavailable until 90 days have been
              observed.
            </p>
          )}
        {leaders && (
          <div className="space-y-3">
            {leaders.worstDay ? (
              <StatCard
                eyebrow="Worst day"
                headline={`${formatAtlantaDay(leaders.worstDay.dayUtc)} — ${leaders.worstDay.count} incident${leaders.worstDay.count === 1 ? '' : 's'}`}
                sub="Most distinct incidents starting on a single Louisville calendar day."
                href={`/day/${new Date(leaders.worstDay.dayUtc).toISOString().slice(0, 10)}`}
              />
            ) : (
              <StatCard
                eyebrow="Worst day"
                headline="Not enough data yet."
                sub="The bots haven't accumulated enough days to pick a winner."
              />
            )}

            {leaders.worstHour ? (
              <StatCard
                eyebrow="Worst hour of the week"
                headline={`${DAYS[leaders.worstHour.weekday]} ${formatHour(leaders.worstHour.hour)} — ${leaders.worstHour.count} incident${leaders.worstHour.count === 1 ? '' : 's'}`}
                sub="Hour-of-week cell with the most incident starts."
              />
            ) : (
              <StatCard eyebrow="Worst hour of the week" headline="Not enough data yet." />
            )}

            {leaders.worstStation ? (
              <StatCard
                eyebrow="Most-affected station (90d)"
                headline={`${leaders.worstStation.name} — ${leaders.worstStation.count} incident${leaders.worstStation.count === 1 ? '' : 's'}`}
                sub={
                  leaders.worstStation.lines.length > 0
                    ? `Lines: ${leaders.worstStation.lines.map((l) => TRAIN_LINES[l]?.label ?? l).join(', ')}`
                    : null
                }
                href={`/station/${leaders.worstStation.slug}`}
              />
            ) : (
              <StatCard
                eyebrow="Most-affected station (90d)"
                headline="No station-tagged incidents in the window yet."
              />
            )}

            {segments.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 mt-1 px-1">
                  Recurring trouble segments (90d)
                </h2>
                <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
                  {segments.map((s) => {
                    const info = TRAIN_LINES[s.line];
                    return (
                      <a
                        key={`${s.line}|${s.fromStation}|${s.toStation}`}
                        href={`/line/${s.line}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-gh-canvas transition-colors"
                      >
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                          style={{
                            backgroundColor: info?.color ?? '#64748b',
                            color: info?.textColor ?? '#fff',
                          }}
                        >
                          {info?.label ?? s.line}
                        </span>
                        <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">
                          {s.fromStation} → {s.toStation}
                        </span>
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                          ×{s.count}
                        </span>
                      </a>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 px-1">
                  Bot-detected stretches without trains, or held trains, that recurred on the same
                  segment over the last 90 days. Direction-aware — a segment can show up twice if
                  both directions have trouble.
                </p>
              </section>
            )}

            {restorationDeltas &&
              (restorationDeltas.officialClearedEarly.length > 0 ||
                restorationDeltas.officialClearedLate.length > 0) && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 mt-1 px-1">
                    Service-restoration delta (90d)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 px-1">
                    On {restorationDeltas.matchedCount} incident
                    {restorationDeltas.matchedCount === 1 ? '' : 's'} where both TARC and the bot
                    have resolution timestamps, the gap between when TARC marked the alert cleared
                    and when the bot saw sustained service recovery.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <RestorationDeltaList
                      title="TARC cleared early"
                      subtitle="Alert closed before trains recovered"
                      rows={restorationDeltas.officialClearedEarly}
                    />
                    <RestorationDeltaList
                      title="TARC cleared late"
                      subtitle="Service recovered before alert closed"
                      rows={restorationDeltas.officialClearedLate}
                    />
                  </div>
                </section>
              )}

            {leaders.longestIncident ? (
              <StatCard
                eyebrow="Longest single incident"
                headline={`${longestRoutesLabel} — ${formatDuration(leaders.longestIncident.durationMs)}`}
                sub={
                  <>
                    {leaders.longestIncident.headline
                      ? `${leaders.longestIncident.headline} · `
                      : ''}
                    {formatDate(leaders.longestIncident.startTs)}{' '}
                    {formatTime(leaders.longestIncident.startTs)} →{' '}
                    {formatDate(leaders.longestIncident.endTs)}{' '}
                    {formatTime(leaders.longestIncident.endTs)}
                  </>
                }
                href={`/event/${leaders.longestIncident.id}`}
              />
            ) : (
              <StatCard
                eyebrow="Longest single incident"
                headline="No resolved incidents on record yet."
              />
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
