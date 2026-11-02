import { useEffect, useMemo, useRef } from 'react';
import {
  buildBusIncidentsByDay,
  buildIncidentsByDay,
  computeLineReliability,
} from '../lib/aggregate.js';
import { busRouteName } from '../lib/busRoutes.js';
import { atlantaDayUTC, hexToRgba } from '../lib/format.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/trainLines.js';

const ATLANTA_TZ = 'America/New_York';
const atlantaDayMonthFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ATLANTA_TZ,
  month: 'short',
  day: 'numeric',
});
function atlantaDateLabel(ts) {
  return atlantaDayMonthFmt.format(new Date(ts));
}
function atlantaDateBits(ts) {
  const parts = atlantaDayMonthFmt.formatToParts(new Date(ts));
  return {
    day: Number(parts.find((p) => p.type === 'day').value),
    month: parts.find((p) => p.type === 'month').value,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BUS_COLOR = '#64748b'; // slate-500

// Cell background color based on incident count.
function cellBg(count, lineColor) {
  if (count === 0) return 'var(--timeline-empty)';
  if (count === 1) return hexToRgba(lineColor, 0.4);
  return lineColor;
}

const NO_DATA_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(-45deg, var(--no-data-stripe1) 0px, var(--no-data-stripe1) 1px, var(--no-data-stripe2) 1px, var(--no-data-stripe2) 4px)',
};

function DayCell({
  dayIdx,
  dayUTC,
  incidents,
  color,
  dataStartTs,
  coverageDays,
  inRange,
  isPinned,
  onClick,
}) {
  // dayUTC marks the start of this Atlanta calendar day (as a UTC midnight).
  // Treat the day as "no data" if it ended on/before the cutoff.
  const dayEnd = dayUTC + DAY_MS;
  const count = incidents[dayIdx] || 0;
  const noData =
    count === 0 &&
    (dataStartTs == null ||
      dayEnd <= dataStartTs ||
      (Array.isArray(coverageDays) &&
        !coverageDays.includes(new Date(dayUTC).toISOString().slice(0, 10))));
  const dateStr = atlantaDateLabel(dayUTC);
  const label = noData
    ? `${dateStr}: no data`
    : `${dateStr}: ${count} incident${count !== 1 ? 's' : ''}`;
  const dimClass = inRange || isPinned ? '' : 'opacity-30';
  // No-data cells can't usefully filter the list — keep them as inert squares.
  const clickable = !noData && onClick;
  const ringClass = isPinned ? 'ring-1 ring-slate-700 dark:ring-slate-200' : '';
  return (
    <td className="p-0 pr-0.5 pb-0.5">
      {clickable ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={isPinned}
          onClick={() => onClick(dayUTC)}
          className={`block w-2.5 h-2.5 rounded-sm cursor-pointer ${dimClass} ${ringClass}`}
          style={{ backgroundColor: cellBg(count, color) }}
        />
      ) : (
        <div
          title={label}
          className={`w-2.5 h-2.5 rounded-sm ${dimClass}`}
          style={noData ? NO_DATA_STYLE : { backgroundColor: cellBg(count, color) }}
        />
      )}
    </td>
  );
}

export default function Timeline({
  alerts,
  observations,
  selectedLines,
  numDays,
  selectedRangeDays,
  dataStartTs,
  coverageDays,
  // onLineClick / onBusRouteClick used to toggle filter selection; now the
  // labels are anchor links to dedicated pages. Props are still accepted for
  // backward compat with callers that pass them, but ignored here.
  onLineClick: _onLineClick,
  selectedDay = null,
  onDayClick,
  showBus,
  selectedBusRoutes,
  onBusRouteClick: _onBusRouteClick,
  now: nowProp,
}) {
  // Fall back to a fresh `Date.now()` when no `now` is supplied (e.g. test
  // renders). When the prop is provided, day-bucketing advances with the wall
  // clock so a tab open across midnight still shows the correct "today" column.
  const now = nowProp ?? Date.now();
  const scrollRef = useRef(null);

  // Scroll to the right (today) on mount and whenever numDays changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, []);

  const incidentsByDay = useMemo(
    () => buildIncidentsByDay(alerts, observations, numDays, now),
    [alerts, observations, numDays, now],
  );

  // Per-line reliability (incident-free days + current clean streak) for the
  // visible window. Scoped to train rows because bus rows are an aggregate
  // ("top 5 + Other") rather than a single route, so a per-row reliability
  // number would invite the obvious "Other = 45%" comparison and that's
  // meaningless across N≥6 routes lumped together.
  const reliabilityByLine = useMemo(() => {
    const out = {};
    for (const line of TRAIN_LINE_ORDER) {
      const lineAlerts = alerts.filter((a) => a.kind === 'train' && a.routes?.includes(line));
      const lineObs = observations.filter((o) => o.kind === 'train' && o.line === line);
      out[line] = computeLineReliability(lineAlerts, lineObs, { now, windowDays: numDays });
    }
    return out;
  }, [alerts, observations, numDays, now]);

  const busIncidentsByDay = useMemo(
    () => buildBusIncidentsByDay(alerts, observations, numDays, now),
    [alerts, observations, numDays, now],
  );

  // col 0 = oldest day, col numDays-1 = today (Atlanta calendar)
  const days = useMemo(() => {
    const todayUTC = atlantaDayUTC(now);
    return Array.from({ length: numDays }, (_, col) => {
      const dayIdx = numDays - 1 - col;
      const dayUTC = todayUTC - dayIdx * DAY_MS;
      return { col, dayIdx, dayUTC, ...atlantaDateBits(dayUTC) };
    });
  }, [numDays, now]);

  const linesToShow =
    selectedLines !== null && selectedLines.length > 0
      ? TRAIN_LINE_ORDER.filter((l) => selectedLines.includes(l))
      : selectedLines !== null && selectedLines.length === 0
        ? []
        : TRAIN_LINE_ORDER;

  // Bus rows: per-route when routes are selected; otherwise top-5 most-affected
  // routes + an "Other" aggregate for the long tail. The single all-routes
  // aggregate row gets so saturated it's noise, so we surface signal instead.
  const busRowsToShow = showBus
    ? selectedBusRoutes && selectedBusRoutes.length > 0
      ? selectedBusRoutes.map((r) => ({
          key: r,
          routeId: r,
          label: `#${r}`,
          incidents: busIncidentsByDay.byRoute[r] || {},
        }))
      : [
          ...busIncidentsByDay.topRoutes.map((r) => ({
            key: r,
            routeId: r,
            label: `#${r}`,
            incidents: busIncidentsByDay.byRoute[r] || {},
          })),
          ...(Object.keys(busIncidentsByDay.otherAggregate).length > 0
            ? [
                {
                  key: '_other',
                  routeId: null,
                  label: 'Other',
                  incidents: busIncidentsByDay.otherAggregate,
                },
              ]
            : []),
        ]
    : [];

  const hasBusRows = busRowsToShow.length > 0;
  const hasTrainRows = linesToShow.length > 0;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        {numDays}-Day Timeline
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 relative">
        {/* Fade gradient on the right edge — affordance that the grid scrolls
            horizontally on narrow viewports. Inert (pointer-events: none) so
            it doesn't intercept clicks on the rightmost cells. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 rounded-r-lg bg-gradient-to-l from-white dark:from-gh-surface to-transparent sm:hidden"
        />
        <div ref={scrollRef} className="overflow-x-auto pt-1 pb-4">
          <table className="border-collapse">
            <caption className="sr-only">
              Incident timeline. Rows are TARC bus routes; columns are days. Each cell links to that
              day's incidents.
            </caption>
            <thead>
              <tr>
                {/* Corner spacer — matches the width of line label cells */}
                <th className="sticky left-0 bg-white dark:bg-gh-surface z-10 w-12 min-w-[3rem] sm:w-16 sm:min-w-[4rem]" />
                {/* Month label: only render text on the 1st of each month */}
                {days.map(({ col, day, month }) => (
                  <th
                    key={col}
                    scope="col"
                    className="p-0 pr-0.5 pb-1 align-bottom text-left"
                    style={{ width: 12 }}
                  >
                    {day === 1 && (
                      <span
                        className="text-slate-500 dark:text-slate-400 whitespace-nowrap"
                        style={{ fontSize: 10 }}
                      >
                        {month}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Train rows */}
              {linesToShow.map((lineKey) => {
                const info = TRAIN_LINES[lineKey];
                const incidents = incidentsByDay[lineKey] || {};
                const rel = reliabilityByLine[lineKey];
                const pctClean =
                  rel && rel.totalDays > 0
                    ? Math.round((rel.incidentFreeDays / rel.totalDays) * 100)
                    : null;
                const streak = rel?.currentStreakDays ?? 0;
                const relLabel =
                  pctClean != null
                    ? `${pctClean}% clean · current streak ${streak} day${streak === 1 ? '' : 's'} (${numDays}d window)`
                    : null;
                return (
                  <tr key={lineKey}>
                    <td className="sticky left-0 bg-white dark:bg-gh-surface z-10 pr-2 sm:pr-3 align-middle min-w-[3rem] sm:min-w-[4rem]">
                      {/* Anchor (not button) so the label is a real link —
                          middle-click opens in a new tab, link previews
                          work, and the URL is the dedicated /line/:id
                          page. The filter chips above remain for
                          narrowing the existing view. */}
                      <a
                        href={`/line/${lineKey}`}
                        title={relLabel ?? `Open ${info.label} Line page`}
                        className="text-xs font-semibold w-full text-right hover:opacity-70 transition-opacity inline-block leading-tight"
                        style={{ color: info.color }}
                      >
                        <span className="block">{info.label}</span>
                        {pctClean != null && (
                          <span
                            className="block font-normal text-slate-500 dark:text-slate-400 tabular-nums"
                            style={{ fontSize: 9 }}
                          >
                            {pctClean}% · {streak}d
                          </span>
                        )}
                      </a>
                    </td>
                    {days.map(({ col, dayIdx, dayUTC }) => (
                      <DayCell
                        key={col}
                        dayIdx={dayIdx}
                        dayUTC={dayUTC}
                        incidents={incidents}
                        color={info.color}
                        dataStartTs={dataStartTs}
                        coverageDays={coverageDays}
                        inRange={selectedRangeDays == null || dayIdx < selectedRangeDays}
                        isPinned={selectedDay === dayUTC}
                        onClick={onDayClick}
                      />
                    ))}
                  </tr>
                );
              })}

              {/* Thin separator between trains and bus */}
              {hasTrainRows && hasBusRows && (
                <tr>
                  <td colSpan={numDays + 1} className="py-1" />
                </tr>
              )}

              {/* Bus rows */}
              {busRowsToShow.map(({ key, routeId, label, incidents }) => {
                const routeName = routeId ? busRouteName(routeId) : null;
                const tooltip = routeName ? `${label} ${routeName}` : label;
                const ariaLabel = routeName ? `Route ${routeId} ${routeName}` : label;
                return (
                  <tr key={key}>
                    <td className="sticky left-0 bg-white dark:bg-gh-surface z-10 pr-2 sm:pr-3 align-middle min-w-[3rem] sm:min-w-[4rem]">
                      {routeId ? (
                        // Anchor to the dedicated route page. The aggregate
                        // 'Other' row has no routeId and stays inert.
                        <a
                          href={`/route/${routeId}`}
                          title={tooltip}
                          aria-label={ariaLabel}
                          className="text-xs font-semibold w-full text-right hover:opacity-70 transition-opacity inline-block"
                          style={{ color: BUS_COLOR }}
                        >
                          {label}
                        </a>
                      ) : (
                        <span
                          className="text-xs font-semibold w-full block text-right"
                          style={{ color: BUS_COLOR }}
                        >
                          {label}
                        </span>
                      )}
                    </td>
                    {days.map(({ col, dayIdx, dayUTC }) => (
                      <DayCell
                        key={col}
                        dayIdx={dayIdx}
                        dayUTC={dayUTC}
                        incidents={incidents}
                        color={BUS_COLOR}
                        dataStartTs={dataStartTs}
                        coverageDays={coverageDays}
                        inRange={selectedRangeDays == null || dayIdx < selectedRangeDays}
                        isPinned={selectedDay === dayUTC}
                        onClick={onDayClick}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-100 dark:border-gh-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Less</span>
            <div className="flex gap-0.5">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: 'var(--timeline-empty)' }}
              />
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: hexToRgba('#64748b', 0.4) }}
              />
              <div className="w-2.5 h-2.5 rounded-sm bg-slate-500" />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">More</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={NO_DATA_STYLE} />
            <span className="text-xs text-slate-500 dark:text-slate-400">No data</span>
          </div>
          <span className="text-xs text-slate-300 dark:text-slate-600">
            · Click a day to filter · Under each line: % of days with no incident · current clean
            streak
          </span>
        </div>
      </div>
    </section>
  );
}
