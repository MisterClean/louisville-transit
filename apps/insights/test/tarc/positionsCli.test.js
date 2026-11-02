const test = require('node:test');
const assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

test('dry-run samples a partial day without modifying source or publication state', () => {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tarc-position-cli-'));
  const dbPath = Path.join(dir, 'source.sqlite');
  const db = new Database(dbPath);
  db.exec(
    'CREATE TABLE bus_observations (ts INTEGER NOT NULL, route TEXT NOT NULL, trip_id TEXT, vehicle_id TEXT, label TEXT, lat REAL, lon REAL, bearing REAL, speed REAL, occupancy TEXT, vehicle_ts INTEGER, start_date TEXT)',
  );
  const ts = Date.parse('2026-11-02T17:00:00Z');
  db.prepare('INSERT INTO bus_observations (ts, route, lat, lon) VALUES (?, ?, ?, ?)').run(
    ts,
    '01',
    38.25,
    -85.75,
  );
  db.prepare('INSERT INTO bus_observations (ts, route) VALUES (?, ?)').run(ts + 60000, '03');
  db.prepare('INSERT INTO bus_observations (ts, route) VALUES (?, ?)').run(
    ts - 30 * 86400000,
    '01',
  );
  const before = db.prepare('SELECT * FROM bus_observations ORDER BY rowid').all();
  let output;
  try {
    const args = [
      Path.resolve(__dirname, '../../bin/tarc/export-positions.js'),
      '--dry-run',
      '--date',
      '2026-11-02',
      '--limit-rows',
      '1',
    ];
    output = JSON.parse(
      execFileSync(process.execPath, args, {
        env: {
          ...process.env,
          TARC_HISTORY_DB_PATH: dbPath,
          TRANSIT_STATE_DIR: Path.join(dir, 'state'),
          TRANSIT_WEB_DIR: Path.join(dir, 'web'),
        },
        encoding: 'utf8',
      }),
    );
    assert.equal(output.published, false);
    assert.equal(output.source_read_only, true);
    assert.equal(output.files.bus.rows, 1);
    assert.deepEqual(db.prepare('SELECT * FROM bus_observations ORDER BY rowid').all(), before);
    assert.equal(Fs.existsSync(Path.join(dir, 'state')), false);
    assert.equal(Fs.existsSync(Path.join(dir, 'web')), false);
    assert.ok(
      Fs.existsSync(
        Path.join(output.output_directory, output.files.bus.path.slice('positions/'.length)),
      ),
    );
  } finally {
    db.close();
    if (output) Fs.rmSync(output.output_directory, { recursive: true, force: true });
    Fs.rmSync(dir, { recursive: true, force: true });
  }
});
