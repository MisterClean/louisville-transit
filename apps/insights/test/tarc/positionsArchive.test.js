const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../src/tarc/positionsArchive');
const hash = 'a'.repeat(64);
const files = (date) => ({
  bus: {
    format: 'parquet',
    schema_version: A.SCHEMA_VERSION,
    sha256: hash,
    data_revision: hash,
    path: `positions/${A.filePath('bus', date, hash)}`,
    rows: 0,
    bytes: 100,
  },
});
test('Louisville bus schema retains source types and units', () => {
  assert.deepEqual(A.KINDS, ['bus']);
  assert.equal(A.SCHEMA.bus.fields.bearing.type, 'number');
  assert.equal(A.SCHEMA.bus.fields.vehicle_ts.unit, 'epoch s');
  const row = A.toRecord('bus', { ts: 1, route: '001', bearing: 0, speed: 0 });
  assert.equal(row.route, '001');
  assert.equal(row.speed, 0);
  assert.equal(row.vehicle_id, null);
  assert.throws(() => A.toRecord('rail', {}));
});
test('New York calendar boundaries handle both DST changes and invalid dates', () => {
  assert.equal(A.dayBounds('2026-11-01').end - A.dayBounds('2026-11-01').start, 25 * 3600000);
  assert.equal(A.dayBounds('2026-03-08').end - A.dayBounds('2026-03-08').start, 23 * 3600000);
  assert.throws(() => A.dayBounds('2026-02-30'));
  assert.deepEqual(A.completedDays(Date.UTC(2026, 10, 2, 3), '2026-10-30'), [
    '2026-10-30',
    '2026-10-31',
  ]);
  assert.deepEqual(A.completedDays(), []);
  assert.throws(() => A.filePath('rail', '2026-11-01', hash));
});
test('index requires verified parquet and cannot silently discard published days', () => {
  const manifest = A.newManifest();
  manifest.days['2026-11-01'] = { verified: true, files: files('2026-11-01') };
  const index = A.buildIndex(manifest, 0);
  assert.equal(index.timezone, 'America/New_York');
  assert.equal(index.format, 'parquet');
  assert.deepEqual(Object.keys(index.feeds), ['bus']);
  assert.deepEqual(index.known_gaps, []);
  assert.throws(() => A.buildIndex(A.newManifest(), 0, index), /drop published/);
  assert.equal(A.rolloffCutoff(manifest), 0);
});
test('retention stops at first uncommitted day even when verified', () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const manifest = A.newManifest();
  manifest.published = { path: 'manifest.json' };
  for (const date of A.completedDays(now, '2026-10-01'))
    manifest.days[date] = { verified: true, committed: true, files: files(date) };
  assert.equal(A.rolloffCutoff(manifest, now, '2026-10-01'), A.localMidnight('2026-10-26'));
  manifest.days['2026-10-03'].committed = false;
  assert.equal(A.rolloffCutoff(manifest, now, '2026-10-01'), A.localMidnight('2026-10-03'));
});
