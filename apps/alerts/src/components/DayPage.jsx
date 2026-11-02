import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { dayTrail } from '../lib/breadcrumbs.js';
import { atlantaDayUTC, formatAtlantaDay } from '../lib/format.js';
import { loadIndex, loadRange, loadRecent } from '../lib/incidentStore.js';
import { filterIncidents, incidentRecords, legacyKind } from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import { TRAIN_LINES } from '../lib/trainLines.js';
import { dayStringToUtc, parseUrlState } from '../lib/urlState.js';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import IncidentList from './IncidentList.jsx';
import LinePill from './LinePill.jsx';
import NotFoundPage from './NotFoundPage.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;

// `/day/:date` — focused view of a single Atlanta calendar day. Same data
// the homepage shows when you pin a day via the timeline, but as a proper
// permalink: clean URL, dedicated <title>, prerendered OG card.
//
// Rendered content is intentionally minimal — no filter bar (a single-day
// scope makes line/range chips less useful), no full visualizations. Just
// the incidents that touched this day, grouped by line.
export default function DayPage({ dateStr }) {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Parse the URL date once. Invalid strings (e.g. /day/foo) render a
  // not-found card without bothering to fetch.
  const dayUtc = useMemo(() => dayStringToUtc(dateStr), [dateStr]);
  const dayLabel = dayUtc != null ? formatAtlantaDay(dayUtc) : null;

  // Optional line/route scope carried in the query string (?lines=gold,
  // ?lines=none&routes=66). Lets a "view this day" link from a line-scoped
  // surface — e.g. the event page's mini timeline — land filtered to the
  // line in question instead of the whole system. Parsed once: the page is
  // bootstrap-routed, so the query string is stable for its lifetime.
  const scope = useMemo(() => parseUrlState(), []);
  const scopedLines =
    scope.selectedLines && scope.selectedLines.length > 0 ? scope.selectedLines : null;
  const scopedBusRoutes = scope.selectedBusRoutes.length > 0 ? scope.selectedBusRoutes : null;
  const isScoped = scopedLines != null || scopedBusRoutes != null;

  // Future days never have data; show a friendly state rather than an empty
  // list. Past-but-out-of-window days fall through to the "no incidents"
  // branch (consistent with the rest of the site's 90-day archive).
  const isFuture = useMemo(() => {
    if (dayUtc == null) return false;
    return dayUtc > atlantaDayUTC(now);
  }, [dayUtc, now]);

  useEffect(() => {
    if (dayUtc == null) return;
    let alive = true;
    loadIndex()
      .then((index) => {
        // A day inside the recent window is served by the recent slice, which
        // carries active incidents of any age — so a long-runner that started
        // earlier but whose span overlaps this day still shows. Older days come
        // from the month shard(s) overlapping the day.
        const loader =
          index.recent_from_ts != null && dayUtc >= index.recent_from_ts
            ? loadRecent()
            : loadRange(dayUtc, dayUtc + DAY_MS);
        return Promise.all([loader, index]);
      })
      .then(([loaded, index]) => {
        if (!alive) return;
        const incidents = Array.isArray(loaded) ? loaded : loaded.incidents;
        setData({
          incidents,
          generated_at: Array.isArray(loaded) ? index.generated_at : loaded.generated_at,
          data_start_ts: index.data_start_ts ?? null,
          coverage: index.coverage ?? null,
        });
      })
      .catch(setError);
    return () => {
      alive = false;
    };
  }, [dayUtc]);

  // Flat view for the station index and Header; the list reads nested incidents.
  const flat = useMemo(() => (data ? incidentRecords(data.incidents) : null), [data]);

  // Use the standard filter pipeline pinned to this day — incidents whose
  // [start, end] spans overlap. Active incidents that started before today
  // still surface (their span extends to now).
  const filtered = useMemo(() => {
    if (!data || dayUtc == null) return [];
    return filterIncidents(data.incidents, {
      // selectedLines: a real array (even empty) narrows trains; null shows
      // all. A bus-route scope sets lines to [] so trains drop out, leaving
      // just the scoped routes. showBus follows the same contextual default
      // the homepage uses (hidden once a train line is pinned).
      lines: scope.selectedLines,
      startTs: null,
      showBus: scope.showBus,
      busRoutes: scopedBusRoutes,
      selectedDay: dayUtc,
      signals: null,
      search: '',
      now,
    });
  }, [data, dayUtc, now, scope, scopedBusRoutes]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.officialRecords, flat.detectionRecords, { now, windowDays: 90 });
  }, [flat, now]);

  // Distinct lines/routes touched on this day — drives the breakdown chip
  // row at the top of the page. Trains use brand color pills; buses fall
  // back to plain "#NN" chips.
  const breakdown = useMemo(() => {
    const trains = new Set();
    const buses = new Set();
    for (const inc of filtered) {
      const kind = legacyKind(inc);
      if (kind === 'train') for (const r of inc.routes ?? []) trains.add(r);
      else if (kind === 'bus') for (const r of inc.routes ?? []) buses.add(String(r));
    }
    return { trains: [...trains], buses: [...buses].sort() };
  }, [filtered]);

  const totalCount = filtered.length;

  useEffect(() => {
    const base = 'Louisville Transit Alerts';
    if (!dayLabel) {
      document.title = base;
      return;
    }
    document.title = `${dayLabel} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [dayLabel]);

  if (dayUtc == null) {
    return <NotFoundPage />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  // Neighbor links — yesterday / tomorrow — so it's easy to walk through a
  // streak of bad days. Tomorrow is hidden when it'd land in the future.
  const prevStr = new Date(dayUtc - DAY_MS).toISOString().slice(0, 10);
  const nextStr = new Date(dayUtc + DAY_MS).toISOString().slice(0, 10);
  const showNext = dayUtc + DAY_MS <= atlantaDayUTC(now);
  // Carry the scope filter onto the neighbor links so walking a streak of
  // days stays pinned to the same line/route instead of springing open to
  // the whole system on the next click.
  const scopeSuffix = isScoped ? window.location.search : '';

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
          <Breadcrumb items={dayTrail(dayUtc)} className="mb-3" />
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{dayLabel}</h1>
            {data && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {data.data_start_ts == null ||
                dayUtc + DAY_MS <= data.data_start_ts ||
                (dayUtc < atlantaDayUTC(now) &&
                  !(data.coverage?.complete_days || []).includes(dateStr))
                  ? 'Observation coverage unavailable'
                  : `${totalCount} incident${totalCount === 1 ? '' : 's'}`}
                {isFuture ? ' — future date' : ''}
              </span>
            )}
          </div>
          {/* Clarify the count's definition: it counts incidents active on the
              day, including ones that started earlier and were still ongoing —
              so it can exceed a "started this day" tally (e.g. the homepage's
              same-weekday comparison). */}
          {data && totalCount > 0 && !isFuture && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Includes incidents still ongoing from earlier days, not just ones that started this
              day.
            </p>
          )}
          {/* Scope banner — when the day view was opened filtered to a line
              or route, name the filter and offer a one-click escape to the
              full day. Without the escape hatch a scoped permalink looks like
              the day only had that line's incidents. */}
          {isScoped && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3 text-sm text-slate-500 dark:text-slate-400">
              <span>Filtered to</span>
              {scopedLines ? (
                <LinePill kind="train" routes={scopedLines} />
              ) : (
                <LinePill kind="bus" routes={scopedBusRoutes} />
              )}
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <a
                href={`/day/${dateStr}`}
                className="text-blue-500 hover:text-blue-400 hover:underline"
              >
                Show all incidents this day →
              </a>
            </div>
          )}
          {/* Line/route pills touched this day — suppressed under a scope
              filter, where the banner above already names the single line. */}
          {!isScoped && data && (breakdown.trains.length > 0 || breakdown.buses.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {breakdown.trains.map((line) => {
                const info = TRAIN_LINES[line];
                if (!info) return null;
                return (
                  <a
                    key={`train-${line}`}
                    href={`/line/${line}`}
                    className="inline-flex items-center min-h-[24px] px-2 py-0.5 rounded-full text-xs font-bold hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: info.color, color: info.textColor }}
                  >
                    {info.label}
                  </a>
                );
              })}
              {breakdown.buses.map((route) => (
                <a
                  key={`bus-${route}`}
                  href={`/route/${route}`}
                  className="inline-flex items-center min-h-[24px] px-2 py-0.5 rounded-full text-xs font-bold bg-slate-500 text-white hover:opacity-80 transition-opacity"
                >
                  #{route}
                </a>
              ))}
            </div>
          )}
        </div>

        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {data && totalCount === 0 && !isFuture && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            {data.data_start_ts == null ||
            dayUtc + DAY_MS <= data.data_start_ts ||
            (dayUtc < atlantaDayUTC(now) && !(data.coverage?.complete_days || []).includes(dateStr))
              ? 'No observation coverage for this day. Unobserved time is unknown.'
              : `No incidents recorded during the observed portion of ${dayLabel}.`}
          </div>
        )}

        {data && totalCount > 0 && (
          <IncidentList
            incidents={filtered}
            search=""
            onSearchChange={null}
            stationIndex={stationIndex}
            isFiltered
          />
        )}

        {data && (
          <div className="flex justify-between items-center text-sm pt-2">
            <a
              href={`/day/${prevStr}${scopeSuffix}`}
              className="text-blue-500 hover:text-blue-400 hover:underline"
            >
              ← Previous day
            </a>
            {showNext ? (
              <a
                href={`/day/${nextStr}${scopeSuffix}`}
                className="text-blue-500 hover:text-blue-400 hover:underline"
              >
                Next day →
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
