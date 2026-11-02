require('../../src/shared/env');
process.env.TRANSIT_STRICT_INGEST = 'true';
process.env.TARC_STORE_TRIP_UPDATE_STOPS ||= '1';
process.env.TARC_STORE_ALL_STOP_PREDICTIONS ||= 'false';
const fs = require('node:fs');
const path = require('node:path');
const { getVehiclePositions, getTripUpdates } = require('../../src/tarc/bus/api');
const { fetchAlerts } = require('../../src/tarc/alert/api');
const { loadGtfs } = require('../../src/tarc/gtfs');
const storage = require('../../src/tarc/storage');
const store = require('../../src/tarc/alert/store');
const incidents = require('../../src/tarc/shared/incidents');
const { recordCoverage } = require('../../src/shared/coverage');
const stateDir = process.env.TRANSIT_STATE_DIR || path.dirname(process.env.TARC_HISTORY_DB_PATH);
const healthPath = path.join(stateDir, 'feed-health.json');
function readHealth() {
  try {
    return JSON.parse(fs.readFileSync(healthPath, 'utf8'));
  } catch {
    return { started_at: Date.now(), sources: {} };
  }
}
function writeHealth(health) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(`${healthPath}.tmp`, JSON.stringify(health));
  fs.renameSync(`${healthPath}.tmp`, healthPath);
}
function sourceProblem(name, feed, now = Date.now()) {
  const sourceTs = feed.feedTimestamp * 1000;
  if (!sourceTs || sourceTs < now - 300000 || sourceTs > now + 60000)
    return 'Source timestamp missing or stale';
  if (name === 'vehicles' && feed.vehicles.length) {
    const fresh = feed.vehicles.filter(
      (v) => v.ts && now - v.ts * 1000 < 300000 && v.ts * 1000 < now + 60000,
    ).length;
    if (fresh < Math.max(1, feed.vehicles.length / 2))
      return 'Source header is fresh but vehicle observations are stale';
  }
  return null;
}
async function main() {
  const health = readHealth();
  const gtfs = loadGtfs(process.env.TARC_GTFS_DIR);
  const now = Date.now();
  const db = storage.getDb();
  db.exec(
    'CREATE TABLE IF NOT EXISTS feed_snapshots (source TEXT NOT NULL, source_ts INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(source,source_ts))',
  );
  incidents.getDb();
  store.ensureSchema();
  const tasks = {
    vehicles: () => getVehiclePositions({ record: false }),
    trip_updates: () => getTripUpdates({ record: false }),
    alerts: fetchAlerts,
  };
  const results = await Promise.allSettled(Object.values(tasks).map((f) => f()));
  let failed = false;
  const feeds = {};
  const coverageSamples = [];
  for (const [i, name] of Object.keys(tasks).entries()) {
    const result = results[i];
    const previous = health.sources[name] || {};
    if (result.status === 'rejected') {
      failed = true;
      health.sources[name] = { ...previous, attempted_at: now, error: result.reason.message };
      continue;
    }
    const feed = result.value;
    const sourceTs = feed.feedTimestamp * 1000;
    const problem = sourceProblem(name, feed, now);
    if (problem) {
      failed = true;
      health.sources[name] = {
        ...previous,
        attempted_at: now,
        error: problem,
        source_timestamp: sourceTs || null,
      };
      continue;
    }
    feeds[name] = feed;
    health.sources[name] = {
      attempted_at: now,
      last_success_at: now,
      source_timestamp: sourceTs,
      count: (feed.vehicles || feed.tripUpdates || feed.alerts).length,
      error: null,
    };
    feed.advanced = sourceTs > (previous.source_timestamp || 0);
    const inserted = db
      .prepare('INSERT OR IGNORE INTO feed_snapshots(source,source_ts,count) VALUES(?,?,?)')
      .run(name, sourceTs, health.sources[name].count);
    if (name === 'vehicles' && inserted.changes)
      coverageSamples.push([sourceTs, previous.error ? null : previous.source_timestamp]);
  }
  const publicRoute = (entity) =>
    gtfs.resolveRoute(entity)?.route.route_short_name || entity.realtimeRouteId;
  if (feeds.trip_updates?.advanced)
    storage.recordBusTripUpdates(
      feeds.trip_updates.tripUpdates.map((t) => ({ ...t, realtimeRouteId: publicRoute(t) })),
      feeds.trip_updates.feedTimestamp * 1000,
    );
  if (feeds.vehicles?.advanced) {
    const updates = new Map((feeds.trip_updates?.tripUpdates || []).map((t) => [t.tripId, t]));
    storage.recordBusObservations(
      feeds.vehicles.vehicles.map((v) => ({
        ...v,
        realtimeRouteId: publicRoute(v),
        startDate: v.startDate || updates.get(v.tripId)?.startDate,
      })),
      feeds.vehicles.feedTimestamp * 1000,
    );
  }
  if (feeds.alerts?.advanced) {
    const seen = new Set();
    for (const a of feeds.alerts.alerts) {
      if (
        a.activePeriods.length &&
        !a.activePeriods.some(
          (p) => (!p.start || p.start * 1000 <= now) && (!p.end || p.end * 1000 > now),
        )
      )
        continue;
      seen.add(a.id);
      const routes = [
        ...new Set(
          a.informedEntities
            .map(
              (e) =>
                gtfs.resolveRoute({ tripId: e.tripId, realtimeRouteId: e.routeId })?.route
                  .route_short_name,
            )
            .filter(Boolean),
        ),
      ];
      const starts = a.activePeriods.map((p) => p.start).filter(Boolean),
        ends = a.activePeriods.map((p) => p.end).filter(Boolean);
      store.recordAlertSeen(
        {
          alertId: a.id,
          mode: 'bus',
          routes: routes.join(',') || null,
          headline: a.header || a.description || 'TARC service alert',
          description: a.description || a.header,
          cause: a.cause,
          effect: a.effect,
          activeStartTs: starts.length ? Math.min(...starts) : null,
          activeEndTs: ends.length ? Math.max(...ends) : null,
          postUri: null,
        },
        now,
      );
      store.resetAlertClearTicks(a.id);
    }
    for (const a of store.listUnresolvedAlerts())
      if (!seen.has(a.alert_id)) {
        store.incrementAlertClearTicks(a.alert_id, now);
        const updated = store.getAlertPost(a.alert_id);
        if (updated.clear_ticks >= store.ALERT_CLEAR_TICKS)
          store.recordAlertResolved({ alertId: a.alert_id, replyUri: null }, now);
      }
  }
  for (const [sourceTs, previousTs] of coverageSamples) recordCoverage(db, sourceTs, previousTs);
  health.updated_at = now;
  health.status = failed ? 'degraded' : 'ok';
  if (!failed) {
    health.last_success_at = now;
    health.first_complete_snapshot_at ||= now;
  }
  writeHealth(health);
  db.prepare('DELETE FROM feed_snapshots WHERE source_ts < ?').run(now - 86400000);
  storage.rolloffOldObservations();
  storage.closeDb();
  if (failed) throw new Error('One or more TARC source feeds failed or are stale');
}
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { main, readHealth, sourceProblem };
