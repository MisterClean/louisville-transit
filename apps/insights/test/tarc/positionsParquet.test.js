const test = require('node:test');
const assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { DuckDBInstance } = require('@duckdb/node-api');
const { writeDay, exportDay, sha256 } = require('../../src/tarc/positionsParquet');
const { dayBounds, SCHEMA } = require('../../src/tarc/positionsArchive');
const date = '2026-11-02';
const row = {
  ts: dayBounds(date).start,
  route: '001',
  trip_id: '00012',
  vehicle_id: '0007',
  label: '001',
  lat: 38.1234567890123,
  lon: -85.1234567890123,
  bearing: 0.25,
  speed: 0,
  occupancy: null,
  vehicle_ts: 1793595600,
  start_date: '20261102',
};
function scratch(t) {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tarc-parquet-test-'));
  t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('real Parquet preserves nulls, precision, zeroes, identifiers, duplicates and sorted schema', async (t) => {
  const dir = scratch(t);
  const input = [{ ...row, route: '009', vehicle_id: null, lat: null }, row, row];
  const files = await writeDay(input, date, dir);
  const file = files.bus;
  assert.equal(file.rows, 3);
  const path = Path.join(dir, file.path.replace(/^positions\//, ''));
  assert.equal(await sha256(path), file.sha256);
  const instance = await DuckDBInstance.create();
  const connection = await instance.connect();
  try {
    const read = await connection.runAndReadAll(`SELECT * FROM read_parquet('${path}')`);
    const values = read.getRows().map((r) => r.map((v) => (typeof v === 'bigint' ? Number(v) : v)));
    assert.deepEqual(
      values,
      [row, row, input[0]].map((r) => Object.keys(SCHEMA.bus.fields).map((key) => r[key])),
    );
    assert.equal(file.quality.distinct_polls, 1);
    assert.equal(file.quality.invalid_coordinate_rows, 1);
    const types = await connection.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet('${path}')`);
    assert.deepEqual(
      types.getRows().map((r) => r[1]),
      [
        'BIGINT',
        'VARCHAR',
        'VARCHAR',
        'VARCHAR',
        'VARCHAR',
        'DOUBLE',
        'DOUBLE',
        'DOUBLE',
        'DOUBLE',
        'VARCHAR',
        'BIGINT',
        'VARCHAR',
      ],
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
});
test('empty days produce readable typed Parquet', async (t) => {
  const files = await writeDay([], date, scratch(t));
  assert.equal(files.bus.rows, 0);
  assert.equal(files.bus.ts_min, null);
});
test('invalid records fail before publication and clean staging', async (t) => {
  for (const change of [
    { route: 1 },
    { ts: row.ts - 1 },
    { speed: NaN },
    { lat: Infinity },
    { kind: 'rail' },
  ]) {
    const dir = scratch(t);
    await assert.rejects(writeDay([{ ...row, ...change }], date, dir));
    assert.deepEqual(Fs.readdirSync(dir), []);
  }
});
test('SQLite export filters poll day without dropping duplicate observations', async (t) => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  t.after(() => db.close());
  const fields = Object.entries(SCHEMA.bus.fields);
  db.exec(
    `CREATE TABLE bus_observations (${fields.map(([key, value]) => `${key} ${value.type === 'string' ? 'TEXT' : value.type === 'integer' ? 'INTEGER' : 'REAL'}`).join(',')})`,
  );
  const insert = db.prepare(
    `INSERT INTO bus_observations VALUES (${fields.map(() => '?').join(',')})`,
  );
  for (const record of [row, row, { ...row, ts: row.ts - 1 }])
    insert.run(...fields.map(([key]) => record[key]));
  const files = await exportDay(db, date, scratch(t));
  assert.equal(files.bus.rows, 2);
});
