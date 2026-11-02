import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { eventTrail } from '../lib/breadcrumbs.js';
import { getIncidentWithContext } from '../lib/incidentStore.js';
import {
  formatRoutesLabel,
  incidentLifecycle,
  incidentRecords,
  legacyKind,
} from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import Breadcrumb from './Breadcrumb.jsx';
import BrowseMenu from './BrowseMenu.jsx';
import { EventDetail } from './event/EventDetail.jsx';
import EventNav from './event/EventNav.jsx';
import { describeText, incidentRoutes } from './event/incidentText.jsx';
import { CrossLineContext, RelatedIncidents } from './event/RelatedIncidents.jsx';
import Footer from './Footer.jsx';
import NotFoundPage from './NotFoundPage.jsx';

export default function EventPage({ eventId }) {
  const [dark, toggleDark] = useDarkMode();
  // `result` is { incident, incidents }: the resolved incident plus a context
  // set wide enough for the nav / related / cross-line callouts to be correct
  // across shard boundaries (its slice + adjacent months + its lines' all-time
  // files). `notFound` distinguishes "resolved nowhere" from "still loading".
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  // Initial fetch + 5-minute poll. Matches App.jsx's cadence so an event
  // page left open on an active incident updates its duration / "ongoing"
  // chip / resolution status without a reload. Only the initial fetch
  // surfaces a hard error — silent failures after that keep the existing
  // data visible rather than yanking the page out from under the reader.
  // getIncidentWithContext resolves the id through the store (recent → index →
  // shard) so an archived deep link works without the full history; its lazy
  // fetches are memoized, so the poll mostly just revalidates the recent slice.
  useEffect(() => {
    let active = true;

    function fetchData() {
      getIncidentWithContext(eventId)
        .then((res) => {
          if (!active) return;
          if (!res) {
            setNotFound(true);
            return;
          }
          setNotFound(false);
          setResult(res);
        })
        .catch((err) => {
          if (!active) return;
          setResult((prev) => {
            if (!prev) setError(err);
            return prev;
          });
        });
    }

    fetchData();
    const id = setInterval(fetchData, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [eventId]);

  const incident = result?.incident ?? null;
  const incidents = result?.incidents ?? [];

  // Flat { alerts, observations } view of the context set — the station index
  // and BrowseMenu (and, via EventDetail, the cohort stats) still read the flat
  // shape. The view itself renders the nested `incident` directly.
  const flat = useMemo(() => (result ? incidentRecords(incidents) : null), [result, incidents]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.officialRecords, flat.detectionRecords, { windowDays: 90 });
  }, [flat]);

  // Set the tab title from the incident so bookmarks and shared links land in
  // browser history with something readable, not the generic site title.
  useEffect(() => {
    const base = 'Louisville Transit Alerts';
    if (!incident) {
      document.title = base;
      return;
    }
    // Prefix the tab title with the route label so a generic agency headline
    // (e.g. "Temporary Reroute") doesn't lose the route context the rest of
    // the page makes obvious.
    const label = formatRoutesLabel(legacyKind(incident), incidentRoutes(incident));
    const desc = describeText(incident);
    document.title = `${label} · ${desc} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [incident]);

  if (notFound) {
    return <NotFoundPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
        <div className="flex items-center justify-between mb-4">
          <Breadcrumb
            items={
              incident
                ? eventTrail(
                    incidentLifecycle(incident).first_seen_ts,
                    formatRoutesLabel(legacyKind(incident), incidentRoutes(incident)),
                  )
                : [{ label: 'Home', href: '/' }, { label: 'Incident' }]
            }
          />
          <div className="flex items-center gap-2">
            <BrowseMenu alerts={flat?.alerts} observations={flat?.observations} />
            <button
              type="button"
              onClick={toggleDark}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors"
              aria-label="Toggle dark mode"
            >
              {dark ? '☀️' : '🌙'}
              <span>{dark ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">Failed to load alert data.</p>}

        {!error && !result && (
          <div className="h-32 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border animate-pulse" />
        )}

        {incident && (
          <>
            <EventDetail
              dataStartTs={result?.data_start_ts ?? null}
              coverageDays={result?.coverage?.complete_days ?? []}
              incident={incident}
              incidents={incidents}
              alerts={flat.officialRecords}
              observations={flat.detectionRecords}
              stationIndex={stationIndex}
              dark={dark}
            />
            <RelatedIncidents
              incident={incident}
              incidents={incidents}
              stationIndex={stationIndex}
            />
            <CrossLineContext
              incident={incident}
              incidents={incidents}
              stationIndex={stationIndex}
            />
            <EventNav incident={incident} incidents={incidents} />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
