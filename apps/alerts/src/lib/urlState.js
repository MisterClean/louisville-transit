import { SIGNAL_TYPES, SOURCE_TYPES } from './incidents.js';
import { normalizeTrainLine, TRAIN_LINE_ORDER } from './trainLines.js';

// Source filter uses "selected = shown" semantics: an empty URL/state means
// "everything is shown", which we represent internally as all SOURCE_TYPES
// being present (so the popover chips all read as active by default rather
// than all inactive — the latter was confusing and made the default state
// look like a destructive empty filter).
const DEFAULT_SOURCES = [...SOURCE_TYPES];

const VALID_RANGES = new Set([7, 30, 60, 90]);
const TRAIN_LINE_SET = new Set(TRAIN_LINE_ORDER);
const SIGNAL_SET = new Set(SIGNAL_TYPES);
const SOURCE_SET = new Set(SOURCE_TYPES);
const DAY_PARAM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Format a UTC epoch (Atlanta day midnight) as a YYYY-MM-DD string. Cleaner in
// URLs than an epoch, and the round-trip is unambiguous because the value is
// always a UTC midnight.
function dayUtcToString(dayUtc) {
  const d = new Date(dayUtc);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayStringToUtc(s) {
  const m = DAY_PARAM_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject overflow normalization (e.g. Feb 30 → Mar 2) by checking the
  // round-trip matches the input components.
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return utc;
}

export { dayStringToUtc, dayUtcToString };

// Bus visibility defaults to hidden when the user has narrowed to a specific
// set of train lines — otherwise a "Red Line view" link surfaces unrelated
// bus disruptions on the other side of the city. Returns true when the
// default should be "show buses".
function defaultShowBus(selectedLines) {
  return !(selectedLines !== null && selectedLines.length > 0);
}

export { defaultShowBus };

// localStorage key for cross-visit filter persistence. Stored as JSON; the
// shape mirrors the small "sticky" subset of App state — line/bus/signal
// selections — that's worth carrying across visits. dateRange and the
// pinned day are deliberately excluded: a stale "30d" choice from last
// month feels more confusing than helpful.
const STORAGE_KEY = 'atlanta-transit-alerts:filters';
const LEGACY_STORAGE_KEY = 'official-alert-history:filters';
const STICKY_KEYS = [
  'selectedLines',
  'showBus',
  'selectedBusRoutes',
  'selectedSignals',
  'selectedSources',
];

export function readStoredFilters() {
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacy) return null;
      window.localStorage.setItem(STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      raw = legacy;
    }
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredFilters(state) {
  try {
    const slim = {};
    for (const k of STICKY_KEYS) {
      if (state[k] !== undefined) slim[k] = state[k];
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    // localStorage can be disabled (private mode, quotas) — fall through
    // silently rather than blowing up the UI for a nice-to-have.
  }
}

// Parse URLSearchParams into the same shape App holds in state. Unknown values
// are dropped silently — a stale or hand-edited URL falls back to defaults
// rather than crashing.
export function parseUrlState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const out = {
    selectedLines: null,
    showBus: true,
    selectedBusRoutes: [],
    dateRange: 7,
    selectedDay: null,
    selectedSignals: [],
    selectedSources: [...DEFAULT_SOURCES],
    search: '',
  };

  const linesParam = params.get('lines');
  if (linesParam === 'none') {
    out.selectedLines = [];
  } else if (linesParam) {
    // Normalize TARC short codes to full names so old shareable URLs
    // (?lines=org,p) keep working after the rename.
    const valid = linesParam
      .split(',')
      .map((s) => normalizeTrainLine(s.trim()))
      .filter((s) => TRAIN_LINE_SET.has(s));
    if (valid.length > 0) out.selectedLines = valid;
  }

  // Bus visibility: explicit param wins; otherwise contextual default based
  // on whether train lines are narrowed.
  const busParam = params.get('bus');
  if (busParam === '0') out.showBus = false;
  else if (busParam === '1') out.showBus = true;
  else out.showBus = defaultShowBus(out.selectedLines);

  const routesParam = params.get('routes');
  if (routesParam) {
    out.selectedBusRoutes = routesParam
      .split(',')
      .map((s) => s.trim())
      // TARC route ids aren't always plain numbers — express/owl/named routes
      // carry letters (X9, J14, N5, 53A, 55N). Accept any token with at least
      // one digit and only alphanumerics; that admits every real route while
      // still dropping garbage like "abc" or "none". Non-existent ids simply
      // match no incident downstream, so the filter is harmless either way.
      .filter((s) => /^[A-Za-z]*\d+[A-Za-z]*$/.test(s));
  }

  const rangeParam = params.get('range');
  if (rangeParam === 'all') {
    out.dateRange = null;
  } else if (rangeParam) {
    const n = Number(rangeParam);
    if (VALID_RANGES.has(n)) out.dateRange = n;
  }

  const dayParam = params.get('day');
  if (dayParam) {
    const utc = dayStringToUtc(dayParam);
    if (utc != null) out.selectedDay = utc;
  }

  const signalsParam = params.get('signals');
  if (signalsParam) {
    out.selectedSignals = signalsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SIGNAL_SET.has(s));
  }

  // `sources=none` is an explicit "show nothing" choice (the user
  // deselected every chip). Any other value yields the listed subset.
  // When the parameter is absent we fall through to DEFAULT_SOURCES — the
  // URL stays clean for the common "show everything" state.
  const sourcesParam = params.get('sources');
  if (sourcesParam === 'none') {
    out.selectedSources = [];
  } else if (sourcesParam) {
    out.selectedSources = sourcesParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SOURCE_SET.has(s));
  }

  const qParam = params.get('q');
  if (qParam) out.search = qParam;

  return out;
}

// Build a URLSearchParams string for the given state. Defaults are omitted so
// the bare URL stays clean and shareable. Returns "" when everything is at
// default (no leading "?").
export function buildSearch({
  selectedLines,
  showBus,
  selectedBusRoutes,
  dateRange,
  selectedDay,
  selectedSignals,
  selectedSources,
  search,
}) {
  const params = new URLSearchParams();

  if (selectedLines !== null) {
    params.set('lines', selectedLines.length === 0 ? 'none' : selectedLines.join(','));
  }
  // Only emit `bus` when it differs from the contextual default — keeps
  // URLs clean for the common cases.
  if (showBus !== defaultShowBus(selectedLines)) {
    params.set('bus', showBus ? '1' : '0');
  }
  if (selectedBusRoutes && selectedBusRoutes.length > 0) {
    params.set('routes', selectedBusRoutes.join(','));
  }
  // Day-pin overrides the range filter visually, but we serialize both so the
  // chip can fall back to the prior range when cleared.
  if (dateRange !== 7) {
    params.set('range', dateRange === null ? 'all' : String(dateRange));
  }
  if (selectedDay != null) {
    params.set('day', dayUtcToString(selectedDay));
  }
  if (selectedSignals && selectedSignals.length > 0) {
    params.set('signals', selectedSignals.join(','));
  }
  // Only serialize when the selection narrows from the default. All-three
  // selected = default = omit. None selected = explicit empty = 'none'
  // (mirrors the lines= behavior so the URL still round-trips).
  if (selectedSources) {
    if (selectedSources.length === 0) {
      params.set('sources', 'none');
    } else if (selectedSources.length < SOURCE_TYPES.length) {
      params.set('sources', selectedSources.join(','));
    }
  }
  if (search && search.trim().length > 0) {
    params.set('q', search.trim());
  }

  const s = params.toString();
  return s ? `?${s}` : '';
}
