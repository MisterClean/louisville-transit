const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Crypto = require('node:crypto');
const Database = require('better-sqlite3');
const {
  archive,
  localPath,
  publishedIndex,
  withLock,
} = require('../../src/tarc/positionsPublication');
const { dayBounds } = require('../../src/tarc/positionsArchive');
function setup(t) {
  const root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'positions-publish-'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE bus_observations (ts INTEGER, route TEXT)');
  t.after(() => {
    db.close();
    Fs.rmSync(root, { recursive: true, force: true });
  });
  const options = {
    db,
    outDir: Path.join(root, 'positions'),
    manifestPath: Path.join(root, 'state.json'),
    now: Date.parse('2026-11-02T17:00:00Z'),
    limit: 3,
  };
  options.writer = async (database, date, outDir) => {
    const { start, end } = dayBounds(date);
    const rows = database
      .prepare('SELECT * FROM bus_observations WHERE ts >= ? AND ts < ? ORDER BY ts')
      .all(start, end);
    const bytes = Buffer.from(JSON.stringify(rows));
    const sha256 = Crypto.createHash('sha256').update(bytes).digest('hex');
    const path = `positions/bus/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.${sha256}.parquet`;
    const filename = localPath(outDir, path);
    Fs.mkdirSync(Path.dirname(filename), { recursive: true });
    Fs.writeFileSync(filename, bytes);
    return {
      bus: {
        path,
        bytes: bytes.length,
        sha256,
        data_revision: sha256,
        format: 'parquet',
        schema_version: 1,
        rows: rows.length,
      },
    };
  };
  return options;
}
test('publication failure preserves old observations; retry commits then prunes', async (t) => {
  const options = setup(t);
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-10-01').start, '01');
  const fail = async () => {
    throw new Error('injected publication failure');
  };
  await assert.rejects(archive({ ...options, publish: fail }), /injected/);
  assert.equal(options.db.prepare('SELECT count(*) AS n FROM bus_observations').get().n, 1);
  await archive({ ...options, limit: 366 });
  await archive({ ...options, limit: 366 });
  assert.equal(options.db.prepare('SELECT count(*) AS n FROM bus_observations').get().n, 0);
  const index = await publishedIndex(options.outDir);
  assert.equal(index.coverage.first, '2026-10-01');
});
test('corrupt and missing manifests fail closed with published history', async (t) => {
  const options = setup(t);
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-11-01').start, '01');
  await archive(options);
  Fs.writeFileSync(options.manifestPath, '{');
  await assert.rejects(archive(options));
  Fs.unlinkSync(options.manifestPath);
  await assert.rejects(archive(options), /Missing archive state/);
});
test('current day is excluded, retained day corrections create new immutable revision', async (t) => {
  const options = setup(t);
  const insert = options.db.prepare('INSERT INTO bus_observations VALUES (?, ?)');
  insert.run(dayBounds('2026-11-01').start, '01');
  insert.run(options.now, '02');
  await archive(options);
  const first = await publishedIndex(options.outDir);
  assert.deepEqual(
    first.days.map((d) => d.date),
    ['2026-11-01'],
  );
  insert.run(dayBounds('2026-11-01').start + 1000, '03');
  await archive(options);
  const next = await publishedIndex(options.outDir);
  assert.notEqual(first.days[0].files.bus.path, next.days[0].files.bus.path);
  assert.equal(next.days[0].files.bus.rows, 2);
  assert.ok(Fs.existsSync(localPath(options.outDir, first.days[0].files.bus.path)));
});
test('empty source does not fabricate history; fall DST day spans 25 hours', async (t) => {
  const options = setup(t);
  assert.equal((await archive(options)).days, 0);
  assert.equal(Fs.existsSync(Path.join(options.outDir, 'index.json')), false);
  const bounds = dayBounds('2026-11-01');
  assert.equal(bounds.end - bounds.start, 25 * 3600000);
});
test('live lock excludes concurrent archive writers', async (t) => {
  const options = setup(t);
  const lock = `${options.manifestPath}.lock`;
  await withLock(lock, async () => {
    await assert.rejects(
      withLock(lock, async () => {}),
      /already running/,
    );
  });
});
test('durable SQLite prune receipt protects history after state-save crash', async (t) => {
  const options = setup(t);
  options.now = Date.parse('2026-11-02T17:00:00Z');
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-10-24').start, '01');
  await archive({ ...options, limit: 366 });
  const before = await publishedIndex(options.outDir);
  const state = JSON.parse(Fs.readFileSync(options.manifestPath));
  state.days['2026-10-24'].pruned = false;
  Fs.writeFileSync(options.manifestPath, JSON.stringify(state));
  await archive({ ...options, limit: 366 });
  const after = await publishedIndex(options.outDir);
  assert.equal(
    after.days.find((d) => d.date === '2026-10-24').files.bus.path,
    before.days.find((d) => d.date === '2026-10-24').files.bus.path,
  );
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-10-24').start, '02');
  await assert.rejects(archive(options), /Late observations/);
});
test('corrupt immutable public manifest prevents any pruning or replacement', async (t) => {
  const options = setup(t);
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-11-01').start, '01');
  await archive(options);
  const pointer = Fs.readFileSync(Path.join(options.outDir, 'index.json'));
  const meta = JSON.parse(pointer);
  Fs.writeFileSync(localPath(options.outDir, meta.path), '{}');
  await assert.rejects(archive(options), /checksum/);
  assert.deepEqual(Fs.readFileSync(Path.join(options.outDir, 'index.json')), pointer);
  assert.equal(options.db.prepare('SELECT count(*) AS n FROM bus_observations').get().n, 1);
});
test('unchanged retained-day rerun preserves pointer and immutable manifest inventory', async (t) => {
  const options = setup(t);
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-11-01').start, '01');
  await archive(options);
  const pointerPath = Path.join(options.outDir, 'index.json');
  const pointer = Fs.readFileSync(pointerPath);
  const files = Fs.readdirSync(Path.join(options.outDir, 'manifests'));
  await archive({ ...options, now: options.now + 3600000 });
  assert.deepEqual(Fs.readFileSync(pointerPath), pointer);
  assert.deepEqual(Fs.readdirSync(Path.join(options.outDir, 'manifests')), files);
});
test('committed state cannot replace a different published revision', async (t) => {
  const options = setup(t);
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-11-01').start, '01');
  await archive(options);
  const pointerPath = Path.join(options.outDir, 'index.json');
  const pointer = Fs.readFileSync(pointerPath);
  const state = JSON.parse(Fs.readFileSync(options.manifestPath));
  const file = state.days['2026-11-01'].files.bus;
  file.sha256 = 'a'.repeat(64);
  file.data_revision = file.sha256;
  file.path = file.path.replace(/[a-f0-9]{64}\.parquet$/, `${file.sha256}.parquet`);
  Fs.writeFileSync(options.manifestPath, JSON.stringify(state));
  await assert.rejects(archive(options), /Committed archive disagrees/);
  assert.deepEqual(Fs.readFileSync(pointerPath), pointer);
  assert.equal(options.db.prepare('SELECT count(*) AS n FROM bus_observations').get().n, 1);
});
test('pointer-commit crash recovers uncommitted state without new publication', async (t) => {
  const options = setup(t);
  options.db
    .prepare('INSERT INTO bus_observations VALUES (?, ?)')
    .run(dayBounds('2026-11-01').start, '01');
  await archive(options);
  const pointerPath = Path.join(options.outDir, 'index.json');
  const pointer = Fs.readFileSync(pointerPath);
  const state = JSON.parse(Fs.readFileSync(options.manifestPath));
  state.days['2026-11-01'].committed = false;
  Fs.writeFileSync(options.manifestPath, JSON.stringify(state));
  await archive({ ...options, now: options.now + 3600000 });
  assert.deepEqual(Fs.readFileSync(pointerPath), pointer);
  assert.equal(
    JSON.parse(Fs.readFileSync(options.manifestPath)).days['2026-11-01'].committed,
    true,
  );
});
