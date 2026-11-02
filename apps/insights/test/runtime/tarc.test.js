const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  activeServices,
  exactScheduled,
  activeTripsForRoute,
  serviceContext,
} = require('../../src/tarc/bus/schedule');
const { ensure, updateEvents } = require('../../scripts/runtime/detect');
const { localIncident } = require('../../scripts/runtime/export');
const { parseTripUpdate } = require('../../src/tarc/bus/api');
const { loadShapes } = require('../../src/tarc/bus/shapes');
const calendar = [
  {
    service_id: 'regular',
    start_date: '20260101',
    end_date: '20261231',
    monday: '1',
    tuesday: '1',
    wednesday: '1',
    thursday: '1',
    friday: '1',
    saturday: '0',
    sunday: '0',
  },
];
test('exact service exceptions replace regular service', () => {
  const index = {
    calendar,
    calendarDates: [
      { date: '20261102', service_id: 'regular', exception_type: '2' },
      { date: '20261102', service_id: 'holiday', exception_type: '1' },
    ],
  };
  assert.deepEqual([...activeServices(index, '20261102')], ['holiday']);
});
test('after-midnight service uses previous service date with GTFS times beyond24', () => {
  const index = {
    calendar,
    calendarDates: [],
    exactTrips: [
      { serviceId: 'regular', route: '01', direction: '0', firstDep: 86400, lastArr: 90000 },
    ],
  };
  const now = new Date('2026-11-03T05:30:00Z');
  assert.equal(serviceContext(now).date, '20261103');
  assert.equal(activeTripsForRoute(index, '01', '0', now), 1);
  assert.equal(
    exactScheduled(index, () => true, now).trips.find((t) => t.firstDep === 0).lastArr,
    3600,
  );
});
test('episode identity survives updates; three clean eligible ticks resolve; stale skips preserve', () => {
  const db = new Database(':memory:');
  ensure(db);
  const c = { source: 'gap', route: '01', direction: 'shape', evidence: { gapMin: 30 } };
  updateEvents(db, [c], 100, new Set(['gap']));
  const id = db.prepare('SELECT id FROM local_events').get().id;
  updateEvents(db, [{ ...c, evidence: { gapMin: 40 } }], 200, new Set(['gap']));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_events').get().n, 1);
  updateEvents(db, [], 300, new Set());
  assert.equal(db.prepare('SELECT clear_ticks FROM local_events').get().clear_ticks, 0);
  for (const now of [400, 500, 600]) updateEvents(db, [], now, new Set(['gap']));
  const row = db.prepare('SELECT * FROM local_events').get();
  assert.equal(row.id, id);
  assert.equal(row.resolved, 600);
  const incident = localIncident(row);
  assert.equal(incident.agency, 'tarc');
  assert.equal(incident.mode, 'bus');
  assert.equal(incident.routes[0], '01');
  assert.equal(incident.detections[0].post_url, null);
  assert.equal(incident.lifecycle.active, false);
  db.close();
});
test('TARC explicit delay parsed without MARTA scheduledTime extension', () => {
  const t = parseTripUpdate({
    id: 'x',
    tripUpdate: {
      trip: { tripId: 't' },
      stopTimeUpdate: [{ stopId: 's', arrival: { time: 1234, delay: 180 } }],
    },
  });
  assert.equal(t.stopUpdates[0].scheduleDeviationSec, 180);
});
test('TARC shape distance in feet remains feet rather than multiplied by kilometres', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-shape-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'shapes.txt'),
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\ns,38.25,-85.76,1,0\ns,38.251,-85.76,2,365\n',
    );
    assert.equal(loadShapes(dir).get('s').lengthFt, 365);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('repeated upstream header cannot advance or resolve an episode', () => {
  const db = new Database(':memory:');
  ensure(db);
  updateEvents(
    db,
    [{ source: 'gap', route: '01', direction: 'shape', evidence: { gapMin: 30 } }],
    100,
    new Set(['gap']),
    90,
  );
  for (const now of [200, 300, 400, 500])
    assert.equal(updateEvents(db, [], now, new Set(['gap']), 90), false);
  const event = db.prepare('SELECT * FROM local_events').get();
  assert.equal(event.resolved, null);
  assert.equal(event.clear_ticks, 0);
  db.close();
});

test('freshness rejects frozen feeds and fresh headers with stale vehicles before detector lifecycle', () => {
  const { sourceProblem } = require('../../scripts/runtime/observe');
  const now = 1793660000000;
  assert.match(
    sourceProblem('vehicles', { feedTimestamp: now / 1000 - 600, vehicles: [] }, now),
    /stale/,
  );
  assert.match(
    sourceProblem(
      'vehicles',
      { feedTimestamp: now / 1000, vehicles: [{ ts: now / 1000 - 600 }] },
      now,
    ),
    /vehicle observations are stale/,
  );
  assert.equal(sourceProblem('vehicles', { feedTimestamp: now / 1000, vehicles: [] }, now), null);
  assert.equal(
    sourceProblem(
      'vehicles',
      { feedTimestamp: now / 1000, vehicles: [{ ts: now / 1000 - 15 }] },
      now,
    ),
    null,
  );
});

test('static route IDs retain leading-zero rider labels and header-only official alerts remain useful', () => {
  const { loadGtfs } = require('../../src/tarc/gtfs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-route-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'routes.txt'),
      'route_id,route_short_name,route_long_name,route_type\n1,01,Dixie Highway,3\n',
    );
    fs.writeFileSync(
      path.join(dir, 'trips.txt'),
      'route_id,service_id,trip_id,direction_id,shape_id\n1,weekday,t,0,s\n',
    );
    fs.writeFileSync(
      path.join(dir, 'stops.txt'),
      'stop_id,stop_name,stop_lat,stop_lon\nstop,Main,38.25,-85.76\n',
    );
    const gtfs = loadGtfs(dir);
    assert.equal(
      gtfs.resolveRoute({ tripId: 't', realtimeRouteId: '1' }).route.route_short_name,
      '01',
    );
    assert.equal(gtfs.resolveRoute({ realtimeRouteId: '1' }).route.route_short_name, '01');
    const { parseAlert } = require('../../src/tarc/alert/api');
    const alert = parseAlert({
      id: '188',
      alert: {
        headerText: {
          translation: [{ language: 'en', text: 'Route 76 detour https://bit.ly/Rt76detour' }],
        },
        informedEntity: [{ agencyId: '40018', routeId: '76' }],
      },
    });
    assert.match(alert.header, /Route 76 detour/);
    assert.equal(alert.description, null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('explicit cancellation window is terminal evidence, not a claim of recovered service', () => {
  const incident = localIncident({
    id: 'cancel',
    source: 'cancellation',
    route: '01',
    direction: null,
    first_seen: 100,
    last_seen: 200,
    resolved: null,
    evidence: JSON.stringify({ count: 2, trip_ids: ['a', 'b'] }),
  });
  assert.equal(incident.lifecycle.active, false);
  assert.equal(incident.lifecycle.resolved_ts, 100);
  assert.match(incident.detections[0].description, /explicitly marked canceled/);
});

test('an ingestion outage resets absence-detector coverage instead of reusing old archive age', () => {
  const { continuousCoverageMinutes } = require('../../scripts/runtime/detect');
  const now = 1793660000000;
  const old = Array.from({ length: 60 }, (_, i) => now - 7200000 + i * 60000);
  const restored = [now - 120000, now - 60000, now];
  assert.equal(continuousCoverageMinutes([...old, ...restored], now), 2);
  assert.equal(continuousCoverageMinutes(old, now), 0);
  assert.equal(
    continuousCoverageMinutes(
      Array.from({ length: 61 }, (_, i) => now - i * 60000),
      now,
    ),
    60,
  );
});

test('public event IDs cannot traverse track/SEO paths and preserve ordinary source IDs', () => {
  const { publicEventId } = require('../../src/shared/publicId');
  assert.equal(publicEventId('188'), '188');
  assert.equal(publicEventId('gap-01-shape-123'), 'gap-01-shape-123');
  for (const id of ['../escape', '..', '.', 'nested/secret', '\\escape', 'x'.repeat(300)]) {
    const safe = publicEventId(id);
    assert.match(safe, /^event-[0-9a-f]{32}$/);
    assert.equal(safe, publicEventId(id));
    assert.equal(path.dirname(path.join('/data/web/tracks', `${safe}.json`)), '/data/web/tracks');
  }
});

test('durable coverage counts only observed source-time intervals and handles 23/25-hour days', () => {
  const { recordCoverage, coverageSummary, dayBounds } = require('../../src/shared/coverage');
  const db = new Database(':memory:');
  const b = dayBounds('2026-11-01');
  assert.equal(b.end - b.start, 25 * 3600000);
  assert.equal(dayBounds('2026-03-08').end - dayBounds('2026-03-08').start, 23 * 3600000);
  let previous = null;
  db.transaction(() => {
    for (let ts = b.start; ts <= b.end; ts += 60000) {
      recordCoverage(db, ts, previous);
      previous = ts;
    }
  })();
  const complete = coverageSummary(db, b.end + 3600000).days.find((d) => d.day === '2026-11-01');
  assert.equal(complete.complete, true);
  assert.equal(complete.fraction, 1);
  const next = dayBounds('2026-11-02');
  // A long gap is unobserved time, not an implicit zero-incident interval.
  recordCoverage(db, next.start + 12 * 3600000, next.start);
  const partial = coverageSummary(db, next.end + 3600000).days.find((d) => d.day === '2026-11-02');
  assert.equal(partial.covered_ms, 0);
  assert.equal(partial.complete, false);
  db.close();
});
