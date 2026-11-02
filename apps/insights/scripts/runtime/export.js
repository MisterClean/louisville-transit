require('../../src/shared/env');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const storage = require('../../src/tarc/storage');
const incidentStore = require('../../src/tarc/shared/incidents');
const alertStore = require('../../src/tarc/alert/store');
const { ensure, continuousCoverageMinutes } = require('./detect');
const { loadGtfs } = require('../../src/tarc/gtfs');
const { loadShapes } = require('../../src/tarc/bus/shapes');
const { buildTrack } = require('../../src/shared/eventTracks');
const exporter = require('../../bin/tarc/export-web');
const { publicEventId } = require('../../src/shared/publicId');
const { coverageSummary } = require('../../src/shared/coverage');
function atomic(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(`${filename}.tmp`, JSON.stringify(data) + '\n');
  fs.renameSync(`${filename}.tmp`, filename);
}
function description(row, e) {
  const route = `Route ${row.route}`;
  switch (row.source) {
    case 'bunching':
      return `${route}: ${e.vehicles?.length || 2} buses clustered within ${Math.round(e.spanFt || 0)} feet.`;
    case 'cross-bunching':
      return `${e.vehicles?.length || 0} buses from ${e.routeCount || 2} routes clustered together.`;
    case 'gap':
      return `${route}: ${Math.round(e.gapMin || e.gapMinutes || 0)} minute estimated spacing between observed buses (distance converted at a typical speed).`;
    case 'ghost':
      return `${route}: ${e.missing} fewer observed buses than the schedule implies (${e.observed} observed, ${e.expected} expected).`;
    case 'thin-gap':
      return `${route}: no bus observed during a ${e.windowMin} minute window with scheduled service.`;
    case 'pulse-cold':
      return `${route}: no bus observed during a ${e.lookbackMin} minute window while other routes reported normally.`;
    case 'cancellation':
      return `${route}: ${e.count} trips explicitly marked canceled by TARC in the past hour.`;
    case 'incident-roundup':
      return `${route}: concurrent ${e.signals.join(', ')} observations.`;
    default:
      return `${route}: ${row.source} observation.`;
  }
}
function localIncident(row) {
  const e = JSON.parse(row.evidence),
    active = row.source !== 'cancellation' && row.resolved == null;
  const lifecycle = {
    first_seen_ts: row.first_seen,
    onset_ts: row.first_seen,
    resolved_ts: row.source === 'cancellation' ? row.first_seen : row.resolved,
    active,
  };
  return {
    id: row.id,
    agency: 'tarc',
    mode: 'bus',
    routes: [row.route],
    sources: ['bot'],
    lifecycle,
    official_alert: null,
    detections: [
      {
        id: row.id,
        source: row.source,
        mode: 'bus',
        lifecycle,
        scope: {
          route: row.route,
          direction: e.direction ?? (e.shapeId ? null : row.direction),
          direction_label: e.direction_label || null,
          shape_id: e.shapeId || null,
          from_station: null,
          to_station: null,
          stations: [],
        },
        description: description(row, e),
        evidence: { details: e, signals: e.signals || [row.source], bullets: null },
        post_url: null,
      },
    ],
  };
}
function main() {
  const dir = process.env.TRANSIT_WEB_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const db = storage.getDb();
  incidentStore.getDb();
  alertStore.ensureSchema();
  ensure(db);
  const out = exporter.buildExport(db);
  let media = {};
  try {
    media = JSON.parse(fs.readFileSync(path.join(dir, 'media/media-index.json'), 'utf8'));
  } catch {}
  const local = db
    .prepare('SELECT * FROM local_events ORDER BY first_seen DESC')
    .all()
    .map(localIncident);
  out.incidents.push(...local);
  for (const event of out.incidents) {
    const safe = publicEventId(event.id);
    if (safe !== event.id) {
      event.original_id = event.id;
      event.id = safe;
    }
  }
  for (const event of out.incidents)
    for (const d of event.detections || []) if (media[event.id]) d.evidence.media = media[event.id];
  out.incidents.sort((a, b) => b.lifecycle.first_seen_ts - a.lifecycle.first_seen_ts);
  let health;
  try {
    health = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(process.env.TARC_HISTORY_DB_PATH), 'feed-health.json'),
        'utf8',
      ),
    );
  } catch {
    health = { status: 'collecting', started_at: Date.now(), sources: {} };
  }
  const now = Date.now();
  for (const source of Object.values(health.sources))
    source.fresh =
      !!source.last_success_at && !source.error && now - (source.source_timestamp || 0) < 300000;
  health.status =
    Object.values(health.sources).length === 3 &&
    Object.values(health.sources).every((s) => s.fresh)
      ? 'ok'
      : 'degraded';
  out.data_start_ts = health.first_complete_snapshot_at ?? null;
  out.coverage = coverageSummary(db, now);
  atomic(path.join(dir, 'alerts.json'), out);
  exporter.writeShards(out, dir);
  exporter.writeAggregates(out, dir);
  const stat = db
    .prepare(
      'SELECT MIN(ts) AS oldest, MAX(ts) AS newest, COUNT(DISTINCT ts) AS snapshots FROM bus_observations',
    )
    .get();
  const hasSnapshots = db
    .prepare("SELECT name FROM sqlite_master WHERE name='feed_snapshots'")
    .get();
  const pollTimes = hasSnapshots
    ? db
        .prepare("SELECT source_ts FROM feed_snapshots WHERE source='vehicles' AND source_ts>=?")
        .all(now - 6 * 3600000)
        .map((r) => r.source_ts)
    : [];
  stat.continuous_coverage_minutes = continuousCoverageMinutes(pollTimes, now);
  stat.continuous_snapshots = pollTimes.filter(
    (t) => t >= now - stat.continuous_coverage_minutes * 60000 - 300000,
  ).length;
  health.observation_window = stat;
  health.detector =
    db.prepare("SELECT source_ts,updated FROM detector_runs WHERE key='bus'").get() || null;
  health.archive_start = health.first_complete_snapshot_at ?? null;
  health.features = {
    bunching: {
      ready:
        !!health.sources.vehicles?.fresh &&
        stat.continuous_snapshots >= 3 &&
        stat.continuous_coverage_minutes >= 2,
    },
    gaps: {
      ready:
        !!health.sources.vehicles?.fresh &&
        stat.continuous_snapshots >= 3 &&
        stat.continuous_coverage_minutes >= 2,
    },
    ghosts: {
      ready:
        !!health.sources.vehicles?.fresh &&
        stat.continuous_snapshots >= 4 &&
        stat.continuous_coverage_minutes >= 30,
    },
    speedmaps: {
      ready: !!health.sources.vehicles?.fresh && stat.snapshots > 0,
      minimum_route_coverage: 0.3,
    },
    thin_gaps: {
      ready: !!health.sources.vehicles?.fresh && stat.continuous_coverage_minutes >= 120,
    },
    replay: { ready: stat.snapshots >= 2 },
  };
  atomic(path.join(dir, 'health.json'), health);
  const analytics = db.prepare("SELECT payload FROM local_analytics WHERE key='bus'").get();
  let analyticsMedia = [];
  try {
    analyticsMedia = Object.values(
      JSON.parse(fs.readFileSync(path.join(dir, 'media/analytics-media.json'), 'utf8')),
    );
  } catch {}
  atomic(
    path.join(dir, 'analytics.json'),
    analytics
      ? { ...JSON.parse(analytics.payload), media: analyticsMedia }
      : { generated_at: now, status: 'collecting', speedmaps: [], crowding: [], headways: [] },
  );
  const gtfs = loadGtfs(process.env.TARC_GTFS_DIR),
    shapes = loadShapes(process.env.TARC_GTFS_DIR);
  const geometry = {
    agency: 'tarc',
    mode: 'bus',
    routes: gtfs.routes.map((r) => ({
      id: r.route_id,
      route: r.route_short_name,
      name: r.route_long_name,
      color: r.route_color || '155E75',
    })),
    shapes: Object.fromEntries(
      [...shapes].map(([id, s]) => [
        id,
        {
          route: gtfs.routesById.get(gtfs.trips.find((t) => t.shape_id === id)?.route_id)
            ?.route_short_name,
          coordinates: s.points
            .filter((_, i) => i % 5 === 0 || i === s.points.length - 1)
            .map((p) => [p.lon, p.lat]),
          lengthFt: s.lengthFt,
        },
      ]),
    ),
  };
  atomic(path.join(dir, 'routes.json'), geometry);
  const latestTs = db.prepare('SELECT MAX(ts) AS ts FROM bus_observations').get().ts;
  const vehicles =
    health.sources.vehicles?.fresh &&
    health.sources.vehicles?.count > 0 &&
    latestTs &&
    now - latestTs < 300000
      ? db
          .prepare('SELECT * FROM bus_observations WHERE ts=?')
          .all(latestTs)
          .filter((v) => v.vehicle_ts && now - v.vehicle_ts * 1000 < 300000)
          .map((v) => ({
            id: v.vehicle_id,
            route: v.route,
            route_id: gtfs.tripsById.get(v.trip_id)?.route_id || null,
            lat: v.lat,
            lon: v.lon,
            bearing: v.bearing,
            speed: v.speed,
            occupancy: v.occupancy,
            timestamp: v.vehicle_ts * 1000,
            trip_id: v.trip_id,
          }))
      : [];
  atomic(path.join(dir, 'vehicles.json'), {
    generated_at: now,
    source_timestamp: health.sources.vehicles?.source_timestamp || null,
    vehicles,
  });
  const trackDir = path.join(dir, 'tracks');
  fs.mkdirSync(trackDir, { recursive: true });
  const manifest = fs
    .readdirSync(trackDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));
  const query = db.prepare(
    'SELECT ts,vehicle_id,trip_id,lat,lon FROM bus_observations WHERE route=? AND ts BETWEEN ? AND ? ORDER BY ts',
  );
  for (const event of out.incidents) {
    if (event.mode !== 'bus' || !event.routes?.length) continue;
    if (
      event.lifecycle.resolved_ts &&
      (event.lifecycle.resolved_ts < now - 86400000 ||
        fs.existsSync(path.join(trackDir, `${event.id}.json`)))
    )
      continue;
    const end = Math.min(
      event.lifecycle.resolved_ts || now,
      event.lifecycle.first_seen_ts + 4 * 3600000,
    );
    const rows = query
      .all(event.routes[0], event.lifecycle.first_seen_ts - 300000, end + 300000)
      .map((r) => ({ ...r, dir: gtfs.tripsById.get(r.trip_id)?.direction_id ?? null }));
    if (new Set(rows.map((r) => r.ts)).size < 2) continue;
    const track = buildTrack(
      {
        eventId: event.id,
        line: event.routes[0],
        from: null,
        to: null,
        stations: [],
        onset: event.lifecycle.first_seen_ts,
        resolved: event.lifecycle.resolved_ts,
      },
      rows,
      now,
    );
    if (!track) continue;
    track.mode = 'bus';
    track.route = event.routes[0];
    const ids = [
      ...new Set(rows.map((r) => gtfs.tripsById.get(r.trip_id)?.shape_id).filter(Boolean)),
    ];
    track.shapes = ids.map((id) => ({ id, coordinates: geometry.shapes[id]?.coordinates || [] }));
    atomic(path.join(dir, 'tracks', `${event.id}.json`), track);
    if (!manifest.includes(event.id)) manifest.push(event.id);
  }
  atomic(path.join(dir, 'tracks-index.json'), { generated_at: now, event_ids: manifest });
  execFileSync(
    process.execPath,
    [
      path.join(__dirname, '../../bin/tarc/export-daily.js'),
      path.join(dir, 'alerts.json'),
      path.join(dir, 'daily-counts.json'),
    ],
    { stdio: 'inherit' },
  );
  storage.closeDb();
  console.log(`Exported ${out.incidents.length} incidents, ${manifest.length} replay tracks`);
}
if (require.main === module)
  try {
    main();
  } catch (e) {
    console.error(e.stack || e);
    process.exitCode = 1;
  }
module.exports = { localIncident, description, main };
