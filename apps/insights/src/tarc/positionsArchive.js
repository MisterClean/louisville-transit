// TARC bus-only schema version 1; no inferred historical coverage.
// Daily vehicle-position archive: one sorted Parquet file per (kind, Louisville
// calendar day, revision), served from the local public data directory.
// The live observations table only holds a short hot window; see
// docs/POSITIONS.md.

const DAY_MS = 24 * 60 * 60 * 1000;

const TZ = 'America/New_York';
const HOT_WINDOW_DAYS = 7;
const KINDS = ['bus'];
const MANIFEST_VERSION = 2;
const SCHEMA_VERSION = 1;
const SORT_ORDER = ['route', 'vehicle_id', 'ts'];

const BASE_URL = '/data/';

function field(type, nullable, description, unit) {
  return unit ? { type, unit, nullable, description } : { type, nullable, description };
}

const SCHEMA = {
  bus: {
    table: 'bus_observations',
    description: 'TARC bus positions from the GTFS-rt vehicle positions feed',
    fields: {
      ts: field('integer', false, 'VehiclePosition feed snapshot timestamp', 'epoch ms'),
      route: field(
        'string',
        false,
        'Stored public route_short_name (e.g. 01), preserving leading zeroes; not canonical static route_id',
      ),
      trip_id: field('string', true, 'GTFS trip_id, joins to the TARC static schedule'),
      vehicle_id: field('string', true, 'GTFS-rt vehicle id'),
      label: field('string', true, 'GTFS-rt vehicle label as stored, distinct from vehicle_id'),
      lat: field('number', true, 'Latitude', 'degrees'),
      lon: field('number', true, 'Longitude', 'degrees'),
      bearing: field(
        'number',
        true,
        'Stored bearing clockwise from true north; null remains unknown and zero is preserved',
        'degrees',
      ),
      speed: field(
        'number',
        true,
        'Stored speed; null remains unknown and zero is preserved',
        'm/s',
      ),
      occupancy: field('string', true, 'GTFS-rt occupancy status'),
      vehicle_ts: field(
        'integer',
        true,
        'Feed-reported position timestamp, as stored without unit conversion',
        'epoch s',
      ),
      start_date: field('string', true, 'Trip service date (YYYYMMDD)'),
    },
  },
};
const KNOWN_GAPS = [];
function toRecord(kind, row) {
  if (row === undefined) {
    row = kind;
    kind = row.kind || 'bus';
  }
  if (!KINDS.includes(kind)) throw new Error(`Unknown observation kind: ${kind}`);
  return Object.fromEntries(
    Object.keys(SCHEMA[kind].fields).map((name) => [name, row[name] ?? null]),
  );
}

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function localDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

// Louisville midnight for a YYYY-MM-DD date, as epoch ms. DST flips at 2am, so
// midnight is always unambiguous; probe both offsets and keep the one that
// lands on 00:00 local.
function localMidnight(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('Invalid calendar date');
  const [y, m, d] = date.split('-').map(Number);
  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(y, m - 1, d, offsetHours);
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(candidate));
    if (localDate(candidate) === date && hour === '00') return candidate;
  }
  throw new Error(`No Louisville midnight for ${date}`);
}

function dayBounds(date) {
  return { start: localMidnight(date), end: localMidnight(addDays(date, 1)) };
}

// Every finished day from the observed collection start through yesterday (Louisville time).
function completedDays(now = Date.now(), startDate) {
  if (!startDate) return [];
  localMidnight(startDate);
  const today = localDate(now);
  const days = [];
  for (let d = startDate; d < today; d = addDays(d, 1)) days.push(d);
  return days;
}

function filePath(kind, date, sha256) {
  if (!KINDS.includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error('Invalid archive kind, date or SHA-256');
  return `${kind}/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.${sha256}.parquet`;
}

function newManifest() {
  return { manifest_version: MANIFEST_VERSION, days: {}, published: null };
}

function verifiedDay(entry) {
  return (
    entry?.verified === true &&
    KINDS.every((kind) => {
      const file = entry.files?.[kind];
      return (
        file?.format === 'parquet' &&
        file.schema_version === SCHEMA_VERSION &&
        /^[a-f0-9]{64}$/.test(file.sha256) &&
        file.data_revision === file.sha256 &&
        file.path?.endsWith(`.${file.sha256}.parquet`) &&
        Number.isSafeInteger(file.rows) &&
        file.rows >= 0 &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes > 0
      );
    })
  );
}

// Rows older than the hot window may be deleted, but never past the first day
// that hasn't been verified AND committed in the published Parquet manifest.
function rolloffCutoff(manifest, now = Date.now(), startDate) {
  if (!startDate) return 0;
  const today = localDate(now);
  let cutoff = localMidnight(addDays(today, -HOT_WINDOW_DAYS));
  for (const date of completedDays(now, startDate)) {
    const { start } = dayBounds(date);
    if (start >= cutoff) break;
    const entry = manifest.days?.[date];
    if (
      manifest.manifest_version !== MANIFEST_VERSION ||
      !manifest.published ||
      !entry?.committed ||
      !verifiedDay(entry)
    ) {
      cutoff = start;
      break;
    }
  }
  return cutoff;
}

function weekday(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

// Also used to inventory the old index during the one-time migration.
function indexDays(previous) {
  const out = {};
  for (const day of previous?.days || []) {
    if (day?.date && day.files) out[day.date] = day.files;
  }
  return out;
}

// Never silently drop published history or mix NDJSON and Parquet in an index.
function buildIndex(manifest, generatedAt = Date.now(), previous = null) {
  const byDate = {};
  for (const [date, entry] of Object.entries(manifest.days)) {
    if (verifiedDay(entry)) byDate[date] = entry.files;
  }
  for (const date of Object.keys(indexDays(previous))) {
    if (!byDate[date]) throw new Error(`Refusing to drop published day ${date}`);
  }
  const dates = Object.keys(byDate).sort().reverse();
  const days = dates.map((date) => {
    const files = byDate[date];
    const rows = {};
    for (const kind of Object.keys(files)) rows[kind] = files[kind].rows;
    return { date, weekday: weekday(date), rows, files };
  });
  return {
    manifest_version: MANIFEST_VERSION,
    schema_version: SCHEMA_VERSION,
    title: 'TARC bus positions archive',
    generated_at: new Date(generatedAt).toISOString(),
    timezone: TZ,
    days_are: 'Local calendar days in `timezone`, midnight to midnight',
    format: 'parquet',
    compression: 'zstd',
    sort_order: SORT_ORDER,
    previous_manifest: manifest.published?.path ?? null,
    base_url: BASE_URL,
    coverage: { first: dates.at(-1) ?? null, latest: dates[0] ?? null, days: dates.length },
    feeds: SCHEMA,
    known_gaps: KNOWN_GAPS,
    days,
  };
}

module.exports = {
  DAY_MS,
  TZ,
  HOT_WINDOW_DAYS,
  KINDS,
  MANIFEST_VERSION,
  SCHEMA_VERSION,
  SORT_ORDER,
  SCHEMA,
  BASE_URL,
  KNOWN_GAPS,
  toRecord,
  addDays,
  localDate,
  localMidnight,
  dayBounds,
  completedDays,
  filePath,
  newManifest,
  verifiedDay,
  rolloffCutoff,
  indexDays,
  buildIndex,
};
