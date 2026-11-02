import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { fetchAccessibilityData, outagesForStation } from '../lib/accessibility.js';
import { computeTypicalDurations } from '../lib/aggregate.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { formatDate, formatDuration } from '../lib/format.js';
import { loadIndex, loadLine } from '../lib/incidentStore.js';
import { incidentLifecycle, incidentRecords, searchFilterIncidents } from '../lib/incidents.js';
import { buildStationIndex, displayStationName, rosterStationBySlug } from '../lib/stations.js';
import { TRAIN_LINES } from '../lib/trainLines.js';
import ActiveAlerts from './ActiveAlerts.jsx';
import Breadcrumb from './Breadcrumb.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import HourOfWeekHeatmap from './HourOfWeekHeatmap.jsx';
import IncidentList from './IncidentList.jsx';
import NotFoundPage from './NotFoundPage.jsx';

// `/station/:slug` — surfaces every train alert and observation that
// touched a given station within the rolling window. Stations are sparse:
// only train pulse-cold/pulse-held observations and the rare station-scoped
// alert carry endpoint info, so most line incidents won't show up here.
// The page is intentionally narrower than LinePage: no Timeline (a single
// station doesn't make sense as a per-day grid) and no per-line summary
// card.
export default function StationPage({ slug }) {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [accessibilityData, setAccessibilityData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    // A station is served by a fixed set of rail lines (static roster), so we
    // only need those lines' all-time files — not the full history. Filter to
    // the lines the index says actually have a published file so a quiet line
    // (no incidents yet) is never requested (no 404), then union the files
    // (de-duped by id: a transfer station serves multiple lines, and a
    // multi-line incident appears in each line's file).
    const servingLines = rosterStationBySlug(slug)?.lines ?? [];
    loadIndex()
      .then((index) => {
        const existing = new Set((index.lines ?? []).map((l) => l.key));
        const keys = servingLines.filter((l) => existing.has(l));
        return Promise.all([index, Promise.all(keys.map((k) => loadLine(k).catch(() => [])))]);
      })
      .then(([index, lineArrays]) => {
        if (!alive) return;
        const byId = new Map();
        for (const arr of lineArrays) for (const inc of arr) byId.set(inc.id, inc);
        setData({
          incidents: [...byId.values()],
          generated_at: index.generated_at,
          data_start_ts: index.data_start_ts ?? null,
        });
      })
      .catch(setError);
    fetchAccessibilityData()
      .then(setAccessibilityData)
      .catch(() => {
        // The station page still works when the companion accessibility payload
        // has not been published yet.
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Flat view feeds the station index (and Header); the list reads nested
  // incidents reconstructed from the station's records below.
  const flat = useMemo(() => (data ? incidentRecords(data.incidents) : null), [data]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.officialRecords, flat.detectionRecords, { now, windowDays: 90 });
  }, [flat, now]);

  // The activity index covers stations with recent incidents; the roster
  // fallback keeps quiet stations browsable.
  const station = useMemo(() => {
    return stationIndex?.get(slug) ?? rosterStationBySlug(slug);
  }, [slug, stationIndex]);

  // Nested incidents touching this station, reconstructed via the station's
  // flat records' `_incidentId`.
  const stationIncidents = useMemo(() => {
    if (!station || !data) return [];
    const ids = new Set();
    for (const a of station.alerts) if (a._incidentId) ids.add(a._incidentId);
    for (const o of station.observations) if (o._incidentId) ids.add(o._incidentId);
    return data.incidents.filter((inc) => ids.has(inc.id));
  }, [station, data]);

  const activeIncidents = useMemo(
    () =>
      stationIncidents
        .filter((inc) => incidentLifecycle(inc).active)
        .sort((a, b) => incidentLifecycle(b).first_seen_ts - incidentLifecycle(a).first_seen_ts),
    [stationIncidents],
  );

  const typicalDurations = useMemo(() => {
    if (!station) return null;
    return computeTypicalDurations(station.alerts, station.observations, {
      now,
      windowDays: 90,
    });
  }, [station, now]);

  const listFiltered = useMemo(
    () => searchFilterIncidents(stationIncidents, search),
    [stationIncidents, search],
  );
  const stationOutages = useMemo(
    () => outagesForStation(accessibilityData?.outages || [], slug, { now, limit: 8 }),
    [accessibilityData, slug, now],
  );
  const activeStationOutages = stationOutages.filter((o) => o.lifecycle?.active);

  useEffect(() => {
    const base = 'Louisville Transit Alerts';
    if (!station) {
      document.title = base;
      return;
    }
    const prefix = activeIncidents.length > 0 ? `(${activeIncidents.length}) ` : '';
    document.title = `${prefix}${displayStationName(station.name)} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [station, activeIncidents.length]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  if (data && !station) {
    return <NotFoundPage />;
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
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        <div>
          <Breadcrumb
            items={topLevelTrail(station ? displayStationName(station.name) : 'Station')}
            className="mb-3"
          />
          {station && (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {displayStationName(station.name)}
              </h1>
              {activeStationOutages.length > 0 && (
                <a
                  href="/accessibility"
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20"
                >
                  ♿ {activeStationOutages.length} active
                </a>
              )}
              <div className="flex flex-wrap gap-1.5">
                {station.lines.map((line) => {
                  const info = TRAIN_LINES[line];
                  if (!info) return null;
                  return (
                    <a
                      key={line}
                      href={`/line/${line}`}
                      className="inline-flex items-center min-h-[24px] px-2 py-0.5 rounded-full text-xs font-bold hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: info.color, color: info.textColor }}
                    >
                      {info.label}
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {station && (
          <>
            {activeIncidents.length > 0 && (
              <ActiveAlerts
                incidents={activeIncidents}
                now={now}
                typicalDurations={typicalDurations}
                stationIndex={stationIndex}
              />
            )}

            <p className="text-sm text-slate-600 dark:text-slate-300 px-1">
              <strong className="text-slate-800 dark:text-slate-100">{station.count}</strong>{' '}
              incident{station.count === 1 ? '' : 's'} on record (last 90 days)
            </p>

            {stationOutages.length > 0 && (
              <CollapsibleSection
                title="Accessibility"
                subtitle={
                  activeStationOutages.length > 0
                    ? `${activeStationOutages.length} active outage${
                        activeStationOutages.length === 1 ? '' : 's'
                      }`
                    : 'Recent outage history'
                }
                defaultOpen={activeStationOutages.length > 0}
              >
                <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
                  {stationOutages.map((outage) => (
                    <div key={outage.id} className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold capitalize text-slate-800 dark:text-slate-100">
                          {outage.unit_type}
                        </span>
                        {outage.lifecycle?.active ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-gh-subtle dark:text-slate-300">
                            Restored
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {outage.unit_label || outage.headline || 'Accessibility outage'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        First seen {formatDate(outage.lifecycle.first_seen_ts)}
                        {outage.lifecycle.active
                          ? ` · out ${formatDuration(outage.durationMs) || 'just now'}`
                          : outage.lifecycle.restored_ts
                            ? ` · restored ${formatDate(outage.lifecycle.restored_ts)}`
                            : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            <HourOfWeekHeatmap alerts={station.alerts} observations={station.observations} />

            <IncidentList
              incidents={listFiltered}
              search={search}
              onSearchChange={setSearch}
              stationIndex={stationIndex}
              isFiltered
            />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
