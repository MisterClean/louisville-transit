import { useEffect, useMemo, useState } from 'react';
import { useBrowseData } from '../hooks/useBrowseData.js';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { currentlyOut, fetchAccessibilityData } from '../lib/accessibility.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { slugifyStation } from '../lib/stations.js';
import { normalizeTrainLine, TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/trainLines.js';
import trainStations from '../lib/trainStations.json';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';

const TRAIN_LINE_SET = new Set(TRAIN_LINE_ORDER);

// Roster, computed once: numeric-aware A–Z sort (so "35th/Archer" lands ahead
// of "Adams"), plus each station's serving lines normalized to full keys
// legacy route aliases so the line filter can match against TRAIN_LINE_ORDER.
const ROSTER = [...trainStations]
  .map((s) => ({ ...s, normLines: [...new Set((s.lines || []).map(normalizeTrainLine))] }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));

// Group a flat roster into A–Z buckets ("#" first), filtered by a search string.
function groupRoster(roster, search) {
  const q = search.trim().toLowerCase();
  const filtered = q ? roster.filter((s) => s.name.toLowerCase().includes(q)) : roster;
  const byLetter = new Map();
  for (const s of filtered) {
    const key = groupKey(s.name);
    let list = byLetter.get(key);
    if (!list) {
      list = [];
      byLetter.set(key, list);
    }
    list.push(s);
  }
  const ordered = [...byLetter.entries()].sort(([a], [b]) => {
    if (a === '#') return -1;
    if (b === '#') return 1;
    return a.localeCompare(b);
  });
  return { groups: ordered, total: filtered.length };
}

// First-character bucket for the A–Z grouping. Digits (e.g. "35th/Archer",
// "18th") collapse into a single "#" group that sorts ahead of the letters,
// matching how a print directory handles numeric entries.
function groupKey(name) {
  const ch = name.trim().charAt(0).toUpperCase();
  return /[0-9]/.test(ch) ? '#' : ch;
}

// Read the `?lines=` param (shared convention with the rest of the site),
// tolerant of legacy short codes so older shared station links still resolve.
// Returns null (= all lines) when absent or empty.
function parseLinesParam(search) {
  const raw = new URLSearchParams(search).get('lines');
  if (!raw) return null;
  const valid = raw
    .split(',')
    .map((s) => normalizeTrainLine(s.trim()))
    .filter((s) => TRAIN_LINE_SET.has(s));
  return valid.length > 0 ? valid : null;
}

// Small colored squares for the lines physically serving a station — the same
// disambiguator the station's own name parenthetical carries, but scannable.
function LineDots({ lines }) {
  if (!lines || lines.length === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {lines.map((key) => {
        const info = TRAIN_LINES[normalizeTrainLine(key)];
        if (!info) return null;
        return (
          <span
            key={key}
            role="img"
            title={`${info.label} Line`}
            aria-label={`${info.label} Line`}
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: info.color }}
          />
        );
      })}
    </span>
  );
}

// A-Z station list rendered as grouped letter sections.
function StationGroups({ groups, hrefBase, Dots, activeOutageCounts }) {
  return groups.map(([letter, stations]) => (
    <section key={letter}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
        {letter}
      </h3>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
        {stations.map((s) => (
          <li key={s.slug ?? s.name}>
            <a
              href={`${hrefBase}/${s.slug ?? slugifyStation(s.name)}`}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gh-border transition-colors"
            >
              <span className="truncate">{s.name}</span>
              <span className="inline-flex items-center gap-2">
                {activeOutageCounts.get(s.slug ?? slugifyStation(s.name)) > 0 && (
                  <span
                    title={`${activeOutageCounts.get(s.slug ?? slugifyStation(s.name))} active accessibility outage${
                      activeOutageCounts.get(s.slug ?? slugifyStation(s.name)) === 1 ? '' : 's'
                    }`}
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"
                  >
                    ♿
                  </span>
                )}
                <Dots lines={s.lines} />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  ));
}

export default function StationsIndexPage() {
  const [dark, toggleDark] = useDarkMode();
  const { officialRecords, detectionRecords } = useBrowseData();
  // null = all lines; otherwise the subset of full line keys to show. Seeded
  // from the URL so a shared filtered link lands pre-narrowed.
  const [selectedLines, setSelectedLines] = useState(() => parseLinesParam(window.location.search));
  // Free-text station-name filter, seeded from the same `?q=` param the rest
  // of the site uses for search.
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get('q') ?? '',
  );
  const [accessibilityData, setAccessibilityData] = useState(null);

  useEffect(() => {
    document.title = 'All stations · Louisville Transit Alerts';
    fetchAccessibilityData()
      .then(setAccessibilityData)
      .catch(() => {});
    return () => {
      document.title = 'Louisville Transit Alerts';
    };
  }, []);

  // Mirror both filters into the URL so any filtered view is a shareable link
  // (same `?lines=red,blue` and `?q=` shapes the homepage uses).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedLines && selectedLines.length > 0) params.set('lines', selectedLines.join(','));
    else params.delete('lines');
    const q = search.trim();
    if (q) params.set('q', q);
    else params.delete('q');
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, [selectedLines, search]);

  // Toggle a line in/out of the selection. Clearing the last one falls back to
  // null (all) rather than an empty set — on a directory, "no lines selected"
  // most usefully means "show everything", not "show nothing".
  const toggleLine = (line) => {
    setSelectedLines((prev) => {
      if (prev === null) return [line];
      const next = prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line];
      return next.length === 0 ? null : next;
    });
  };

  const { groups, total } = useMemo(() => {
    const sel = selectedLines && selectedLines.length > 0 ? new Set(selectedLines) : null;
    const base = sel ? ROSTER.filter((s) => s.normLines.some((l) => sel.has(l))) : ROSTER;
    return groupRoster(base, search);
  }, [selectedLines, search]);

  const isFiltered = selectedLines !== null || search.trim() !== '';
  const nothingMatches = total === 0;
  const activeOutageCounts = useMemo(() => {
    const counts = new Map();
    for (const outage of currentlyOut(accessibilityData?.outages || [])) {
      const slug = outage.station?.slug;
      if (!slug) continue;
      counts.set(slug, (counts.get(slug) || 0) + 1);
    }
    return counts;
  }, [accessibilityData]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={null}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
        alerts={officialRecords}
        observations={detectionRecords}
      />
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-4 w-full flex-1">
        <div>
          <Breadcrumb items={topLevelTrail('Stations')} className="mb-3" />
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">All stations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">
            Every TARC rail and streetcar station ({trainStations.length} stops). Pick one for its
            alert and disruption history.
          </p>

          {/* Name search — composes with the line filter (line narrows the
              set, text finds the specific stop). */}
          <div className="relative w-full sm:w-72 mb-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stations…"
              aria-label="Search stations by name"
              className="w-full pl-3 pr-7 py-1.5 text-sm rounded-full bg-slate-100 dark:bg-gh-subtle text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent focus:outline-none focus:border-slate-300 dark:focus:border-gh-border focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-base leading-none"
              >
                ×
              </button>
            )}
          </div>

          {/* Line filter — toggle one or more lines to narrow the directory.
              Mirrors the homepage's line chips (brand color when active, dimmed
              when another line is selected). */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
              Filter by TARC line
            </span>
            <button
              type="button"
              onClick={() => setSelectedLines(null)}
              aria-pressed={selectedLines === null}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                selectedLines === null
                  ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
                  : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
              }`}
            >
              All
            </button>
            {TRAIN_LINE_ORDER.map((key) => {
              const info = TRAIN_LINES[key];
              const active = selectedLines?.includes(key);
              const dimmed = selectedLines !== null && !active;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => toggleLine(key)}
                  aria-pressed={!!active}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    dimmed
                      ? 'bg-slate-200 dark:bg-gh-subtle text-slate-500 dark:text-slate-400'
                      : ''
                  }`}
                  style={dimmed ? {} : { backgroundColor: info.color, color: info.textColor }}
                >
                  {info.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {!isFiltered
              ? `${ROSTER.length} TARC stations`
              : `${total} of ${ROSTER.length} TARC station${total === 1 ? '' : 's'}`}
          </p>

          {nothingMatches ? (
            <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 sm:p-6">
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                {search.trim()
                  ? `No stations match “${search.trim()}”${selectedLines === null ? '' : ' on the selected line'}.`
                  : 'No stations on the selected line.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {total > 0 && (
                <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 sm:p-6 space-y-6">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    TARC rail and streetcar stations
                  </h2>
                  <StationGroups
                    groups={groups}
                    hrefBase="/station"
                    Dots={LineDots}
                    activeOutageCounts={activeOutageCounts}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
