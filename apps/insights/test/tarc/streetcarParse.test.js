const test = require('node:test');
const assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');

// Point storage at a throwaway DB BEFORE requiring it (path is read on first
// getDb()), so the round-trip test below doesn't touch the real history DB.
const TMP_DB = Path.join(Os.tmpdir(), `tarc-streetcar-test-${process.pid}-${Date.now()}.sqlite`);
process.env.TARC_HISTORY_DB_PATH = TMP_DB;

const storage = require('../../src/tarc/storage');
const {
  parseStreetcarVehicles,
  parseLastUpdate,
  pickStreetcarRoute,
  streetcarIdFromGtfs,
  STREETCAR_LINE,
} = require('../../src/tarc/streetcar/api');

const data = JSON.parse(
  Fs.readFileSync(Path.join(__dirname, 'fixtures', 'streetcar-otp.json'), 'utf8'),
);

test.after(() => {
  storage.closeDb();
  for (const ext of ['', '-wal', '-shm']) {
    try {
      Fs.unlinkSync(TMP_DB + ext);
    } catch {
      /* best effort */
    }
  }
});

test('parses one record per live streetcar, skipping empty patterns', () => {
  const vehicles = parseStreetcarVehicles(data, 1_781_000_000_000);
  assert.equal(vehicles.length, 2); // the directionId:1:01 pattern has no vehicles

  const byId = new Map(vehicles.map((v) => [v.vehicleId, v]));
  const v1 = byId.get('TARC:1001');
  assert.ok(v1);
  assert.equal(v1.label, '1001');
  assert.equal(v1.line, STREETCAR_LINE);
  assert.equal(v1.direction, '1');
  assert.equal(v1.tripId, 'TARC:10811992');
  assert.equal(v1.polledAt, 1_781_000_000_000);
  assert.ok(Number.isFinite(v1.lat) && Number.isFinite(v1.lon));
  // Downtown Louisville streetcar loop sanity.
  assert.ok(v1.lat > 33.74 && v1.lat < 33.77 && v1.lon > -84.4 && v1.lon < -84.37);
  // OTP doesn't populate speed/heading for the streetcar; carried as null.
  assert.equal(v1.speed, null);
  assert.equal(v1.heading, null);
  // lastUpdate (with offset) resolves to an epoch within the day.
  assert.equal(v1.eventTs, Date.parse('2026-06-15T19:08:53-04:00'));

  assert.equal(byId.get('TARC:1002').direction, '0');
});

test('parseLastUpdate honors the offset and rejects empties', () => {
  assert.equal(parseLastUpdate('2026-06-15T19:08:53-04:00'), Date.parse('2026-06-15T23:08:53Z'));
  assert.equal(parseLastUpdate(null), null);
  assert.equal(parseLastUpdate(''), null);
});

test('streetcar observations round-trip and survive rolloff', () => {
  const vehicles = parseStreetcarVehicles(data, Date.now());
  const now = Date.now();
  storage.recordStreetcarObservations(vehicles, now);
  const rows = storage.getRecentStreetcarObservations(now - 60_000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].line, STREETCAR_LINE);
  assert.ok(rows.every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)));
  assert.ok(rows.some((r) => r.vehicleId === 'TARC:1001' && r.label === '1001'));

  const old = now - 30 * 24 * 60 * 60 * 1000;
  storage.recordStreetcarObservations(vehicles, old);
  storage.rolloffOldObservations(now);
  assert.equal(storage.getRecentStreetcarObservations(old - 60_000).length, 4);
});

// TARC rotates the streetcar's route id when it republishes the feed, and OTP
// answers an unknown id with `route: null` — no error, no rows — so a pinned id
// silently reports an empty fleet forever. These cover both derivations.

test('streetcarIdFromGtfs reads the id out of the feed, not a constant', () => {
  // The fixture predates the 26982 -> 29224 rotation on purpose: the resolver
  // must return whatever routes.txt says, so a future rotation needs no edit.
  const id = streetcarIdFromGtfs(Path.join(__dirname, 'fixtures', 'gtfs', 'routes.txt'));
  assert.equal(id, 'TARC:26982');
});

test('streetcarIdFromGtfs returns null when the GTFS checkout is missing', () => {
  assert.equal(streetcarIdFromGtfs(Path.join(__dirname, 'nope', 'routes.txt')), null);
});

test('pickStreetcarRoute selects the sole TRAM route', () => {
  const routes = [
    { gtfsId: 'TARC:1', shortName: '110', mode: 'BUS' },
    { gtfsId: 'TARC:29226', shortName: 'Blue', longName: 'Blue Line', mode: 'SUBWAY' },
    { gtfsId: 'TARC:29224', shortName: 'SC', longName: 'Louisville Streetcar', mode: 'TRAM' },
  ];
  assert.equal(pickStreetcarRoute(routes).gtfsId, 'TARC:29224');
});

test('pickStreetcarRoute falls back to the long name when mode is absent', () => {
  const routes = [
    { gtfsId: 'TARC:1', longName: 'Some Bus' },
    { gtfsId: 'TARC:29224', longName: 'Louisville Streetcar' },
  ];
  assert.equal(pickStreetcarRoute(routes).gtfsId, 'TARC:29224');
});

test('pickStreetcarRoute returns null when nothing matches', () => {
  assert.equal(pickStreetcarRoute([{ gtfsId: 'TARC:1', mode: 'BUS' }]), null);
  assert.equal(pickStreetcarRoute(null), null);
});
