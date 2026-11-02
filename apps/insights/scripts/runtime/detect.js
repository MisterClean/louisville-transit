require('../../src/shared/env');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../../src/tarc/storage');
const { loadGtfs } = require('../../src/tarc/gtfs');
const { loadShapes, projectObservation } = require('../../src/tarc/bus/shapes');
const schedule = require('../../src/tarc/bus/schedule');
const { bunchesFromObservations, findParkedBusVids } = require('../../src/tarc/bus/bunching');
const { gapsFromObservations } = require('../../src/tarc/bus/gaps');
const { ghostsFromObservations } = require('../../src/tarc/bus/ghosts');
const {
  detectCrossRouteBunches,
  collectShapeTerminals,
  nearAnyTerminal,
} = require('../../src/tarc/bus/crossBunching');
const { detectThinGaps } = require('../../src/tarc/bus/thinGaps');
const { detectBusBlackouts } = require('../../src/tarc/bus/pulse');
const { buildRouteSpeedmaps } = require('../../src/tarc/bus/speedmap');
const { buildRouteCrowdingMaps, summarizeRouteCrowding } = require('../../src/tarc/bus/crowding');
function ensure(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS local_events (id TEXT PRIMARY KEY, event_key TEXT NOT NULL, source TEXT NOT NULL, route TEXT NOT NULL, direction TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, resolved INTEGER, clear_ticks INTEGER DEFAULT 0, evidence TEXT NOT NULL); CREATE INDEX IF NOT EXISTS local_events_key ON local_events(event_key, resolved); CREATE TABLE IF NOT EXISTS detector_runs (key TEXT PRIMARY KEY, source_ts INTEGER, updated INTEGER); CREATE TABLE IF NOT EXISTS local_analytics (key TEXT PRIMARY KEY, updated INTEGER, payload TEXT);`,
  );
}
function continuousCoverageMinutes(timestamps, now = Date.now(), maxGapMs = 300000) {
  const sorted = [...new Set(timestamps)].sort((a, b) => b - a);
  if (!sorted.length || now - sorted[0] > maxGapMs) return 0;
  let oldest = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (oldest - sorted[i] > maxGapMs) break;
    oldest = sorted[i];
  }
  return Math.max(0, (sorted[0] - oldest) / 60000);
}
function updateEvents(db, candidates, now, eligibleSources, sourceTs = null) {
  ensure(db);
  if (
    sourceTs != null &&
    db.prepare("SELECT source_ts FROM detector_runs WHERE key='bus'").get()?.source_ts >= sourceTs
  )
    return false;
  const seen = new Set();
  const tx = db.transaction(() => {
    for (const c of candidates) {
      const key = `${c.source}:${c.route}:${c.direction ?? ''}`;
      seen.add(key);
      const active = db
        .prepare('SELECT id FROM local_events WHERE event_key=? AND resolved IS NULL')
        .get(key);
      if (active)
        db.prepare('UPDATE local_events SET last_seen=?, clear_ticks=0, evidence=? WHERE id=?').run(
          now,
          JSON.stringify(c.evidence),
          active.id,
        );
      else
        db.prepare(
          'INSERT INTO local_events(id,event_key,source,route,direction,first_seen,last_seen,evidence) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          `${key.replaceAll(':', '-')}-${now}`,
          key,
          c.source,
          c.route,
          c.direction ?? null,
          now,
          now,
          JSON.stringify(c.evidence),
        );
    }
    for (const row of db.prepare('SELECT * FROM local_events WHERE resolved IS NULL').all()) {
      if (seen.has(row.event_key) || !eligibleSources.has(row.source)) continue;
      if (row.clear_ticks >= 2)
        db.prepare('UPDATE local_events SET resolved=?, clear_ticks=3 WHERE id=?').run(now, row.id);
      else db.prepare('UPDATE local_events SET clear_ticks=clear_ticks+1 WHERE id=?').run(row.id);
    }
  });
  tx();
  if (sourceTs != null)
    db.prepare("INSERT OR REPLACE INTO detector_runs(key,source_ts,updated) VALUES('bus',?,?)").run(
      sourceTs,
      now,
    );
  return true;
}
async function main() {
  const now = Date.now();
  const health = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(process.env.TARC_HISTORY_DB_PATH), 'feed-health.json'),
      'utf8',
    ),
  );
  if (
    health.sources.vehicles?.error ||
    now - (health.sources.vehicles?.source_timestamp || 0) > 300000
  )
    throw new Error('Vehicle feed unavailable: detection deferred');
  const db = storage.getDb();
  ensure(db);
  const sourceTs = health.sources.vehicles.source_timestamp;
  const previousRun = db.prepare("SELECT source_ts FROM detector_runs WHERE key='bus'").get();
  if (previousRun?.source_ts >= sourceTs) {
    console.log('Source snapshot unchanged; detection lifecycle deferred');
    storage.closeDb();
    return;
  }
  const gtfs = loadGtfs(process.env.TARC_GTFS_DIR),
    shapes = loadShapes(process.env.TARC_GTFS_DIR),
    index = schedule.loadScheduleIndex();
  const routes = gtfs.routes.filter((r) => r.route_type === '3').map((r) => r.route_short_name);
  const rows = storage.getRecentBusObservationsAll(now - 6 * 3600000);
  const hour = rows.filter((o) => o.ts >= now - 3600000),
    recent = hour.filter((o) => o.ts >= now - 180000);
  const latest = [
    ...new Map(
      recent
        .filter((o) => o.vehicleId && now - (o.vehicleTs ? o.vehicleTs * 1000 : o.ts) < 300000)
        .map((o) => [o.vehicleId, o]),
    ).values(),
  ];
  const snapshots = new Set(hour.map((o) => o.ts)).size;
  const snapshotTable = db
    .prepare("SELECT name FROM sqlite_master WHERE name='feed_snapshots'")
    .get();
  const pollTimes = snapshotTable
    ? db
        .prepare(
          "SELECT source_ts FROM feed_snapshots WHERE source='vehicles' AND source_ts>=? ORDER BY source_ts",
        )
        .all(now - 6 * 3600000)
        .map((r) => r.source_ts)
    : rows.map((o) => o.ts);
  const coverageMin = continuousCoverageMinutes(pollTimes, now);
  const candidates = [],
    eligible = new Set();
  const add = (source, route, direction, evidence) =>
    candidates.push({
      source,
      route: String(route),
      direction: direction == null ? null : String(direction),
      evidence: evidence.shapeId
        ? {
            ...evidence,
            direction:
              gtfs.trips.find((t) => t.shape_id === evidence.shapeId)?.direction_id ?? null,
            direction_label:
              gtfs.trips.find((t) => t.shape_id === evidence.shapeId)?.trip_headsign ?? null,
          }
        : evidence,
    });
  const projected = recent
    .map((o) => {
      const p = projectObservation(o, { gtfs, shapes });
      return p ? { ...o, ...p } : null;
    })
    .filter(Boolean);
  const parked = findParkedBusVids(projected);
  if (latest.length > 0 && snapshots >= 3 && coverageMin >= 2) {
    eligible.add('bunching');
    eligible.add('gap');
    eligible.add('cross-bunching');
    for (const b of bunchesFromObservations(latest, { gtfs, shapes, motionRows: recent, now })) {
      const length = shapes.get(b.shapeId)?.lengthFt || 0;
      if (
        b.vehicles.filter((v) => !parked.has(v.vehicleId)).length < 2 ||
        b.vehicles.some((v) => v.distFt < 1000 || length - v.distFt < 1000)
      )
        continue;
      add('bunching', b.route, b.shapeId, b);
    }
    for (const g of gapsFromObservations(latest, { gtfs, shapes, index, now }))
      add('gap', g.route, g.shapeId, g);
    const terminals = collectShapeTerminals(shapes),
      layover = new Set();
    const positioned = latest.map((o) => {
      const trip = gtfs.tripsById.get(o.tripId);
      return { ...o, route: gtfs.routesById.get(trip?.route_id)?.route_short_name, tmstmp: o.ts };
    });
    for (const o of positioned)
      if (nearAnyTerminal(o.lat, o.lon, terminals)) layover.add(o.vehicleId);
    for (const c of detectCrossRouteBunches(positioned, {
      now,
      stoppedIds: parked,
      layoverIds: layover,
    }))
      for (const route of c.routes) add('cross-bunching', route, null, c);
  }
  const statuses = storage.getRecentBusTripStatuses(now - 3600000);
  if (snapshots >= 4 && coverageMin >= 30) {
    eligible.add('ghost');
    for (const g of ghostsFromObservations(hour, {
      gtfs,
      index,
      routes,
      tripStatuses: statuses,
      now,
    }))
      add('ghost', g.route, g.direction, g);
  }
  const byRoute = new Map(routes.map((r) => [r, rows.filter((o) => o.route === r)]));
  const active = (r, date = new Date(now)) =>
    [0, 1].reduce((sum, d) => sum + (schedule.activeTripsForRoute(index, r, d, date) || 0), 0);
  const headway = (r, date = new Date(now)) =>
    schedule.median(
      [0, 1].map((d) => schedule.headwayForRoute(index, r, d, date)).filter((x) => x != null),
    );
  if (coverageMin >= 120 && snapshots >= 30) {
    eligible.add('thin-gap');
    eligible.add('pulse-cold');
    const thin = routes.filter((r) => (headway(r) || 0) >= 20);
    for (const t of detectThinGaps({
      routes: thin,
      getObservations: (r, since) => (byRoute.get(r) || []).filter((o) => o.ts >= since),
      getHeadway: headway,
      getActiveTrips: active,
      getPriorHourActiveTrips: (r) => active(r, new Date(now - 3600000)),
      getNextHourActiveTrips: (r) => active(r, new Date(now + 3600000)),
      now,
    }))
      if (coverageMin >= t.windowMin) add('thin-gap', t.route, null, t);
    const high = routes.filter((r) => headway(r) > 0 && headway(r) < 20);
    const pulse = await detectBusBlackouts({
      routes: high,
      observationsByRoute: new Map(
        [...byRoute].map(([r, obs]) => [r, obs.map((o) => ({ ...o, vid: o.vehicleId }))]),
      ),
      loadPattern: async (id) => ({ id }),
      getKnownPidsForRoute: (r) =>
        gtfs.trips
          .filter((t) => gtfs.routesById.get(t.route_id)?.route_short_name === r)
          .map((t) => t.shape_id),
      expectedRouteActive: active,
      expectedHeadway: (r, _pattern, date) => headway(r, date),
      globalDistinctTs: snapshots,
      recentlyActiveRoutes: new Set(rows.map((o) => o.route)),
      now,
      opts: { minuteOfHour: new Date(now).getUTCMinutes() },
    });
    for (const p of pulse.candidates) add('pulse-cold', p.route, null, p);
  }
  if (!health.sources.trip_updates?.error) {
    eligible.add('cancellation');
    const canceled = new Map();
    for (const t of statuses)
      if (t.tripRelationship === 'CANCELED') {
        if (!canceled.has(t.route)) canceled.set(t.route, new Set());
        canceled.get(t.route).add(t.tripId);
      }
    for (const [r, trips] of canceled)
      add('cancellation', r, null, { trip_ids: [...trips], count: trips.size, window_min: 60 });
  }
  const speedmaps = buildRouteSpeedmaps(hour, { gtfs, shapes });
  const crowding = buildRouteCrowdingMaps(hour, { gtfs, shapes });
  const bySignalRoute = new Map();
  for (const c of candidates) {
    if (!['bunching', 'gap', 'ghost', 'thin-gap', 'pulse-cold'].includes(c.source)) continue;
    if (!bySignalRoute.has(c.route)) bySignalRoute.set(c.route, []);
    bySignalRoute.get(c.route).push(c);
  }
  eligible.add('incident-roundup');
  for (const [route, signals] of bySignalRoute)
    if (new Set(signals.map((s) => s.source)).size >= 2)
      add('incident-roundup', route, null, {
        signals: [...new Set(signals.map((s) => s.source))],
        observations: signals,
      });
  const adherence = db
    .prepare(
      `SELECT trip_id, vehicle_id, schedule_deviation_sec AS delay_sec, stop_id, arrival_time FROM bus_trip_updates WHERE ts >= ? AND schedule_relationship NOT IN ('NO_DATA','SKIPPED') AND schedule_deviation_sec IS NOT NULL AND arrival_time >= ? ORDER BY ts DESC,arrival_time ASC`,
    )
    .all(now - 300000, now / 1000);
  const analytics = {
    adherence: {
      method: 'GTFS-rt predicted delay',
      samples: [...new Map(adherence.map((a) => [`${a.trip_id}:${a.stop_id}`, a])).values()],
    },
    generated_at: now,
    sample_count: hour.length,
    snapshot_count: snapshots,
    coverage_minutes: coverageMin,
    speedmaps: [...speedmaps],
    crowding: [...crowding],
    crowding_rollup: summarizeRouteCrowding(hour, { gtfs }),
    headways: routes.map((route) => ({
      route,
      directions: [0, 1].map((direction) => ({
        direction,
        headway_min: schedule.headwayForRoute(index, route, direction, new Date(now)),
        expected_active: schedule.activeTripsForRoute(index, route, direction, new Date(now)),
      })),
    })),
  };
  db.prepare('INSERT OR REPLACE INTO local_analytics(key,updated,payload) VALUES(?,?,?)').run(
    'bus',
    now,
    JSON.stringify(analytics),
  );
  updateEvents(db, candidates, now, eligible, sourceTs);
  console.log(
    `Detection: ${candidates.length} signals; ${snapshots} independent snapshots; ${coverageMin.toFixed(1)} minutes observed`,
  );
  storage.closeDb();
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.stack || e);
    process.exitCode = 1;
  });
module.exports = { ensure, updateEvents, main, continuousCoverageMinutes };
