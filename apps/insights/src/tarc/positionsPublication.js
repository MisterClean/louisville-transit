const Fs = require('node:fs');
const Path = require('node:path');
const Crypto = require('node:crypto');
const { sha256, exportDay } = require('./positionsParquet');
const {
  MANIFEST_VERSION,
  buildIndex,
  verifiedDay,
  localDate,
  dayBounds,
  addDays,
} = require('./positionsArchive');

function readJson(path, fallback) {
  try {
    return JSON.parse(Fs.readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}
function writeJson(path, value) {
  Fs.mkdirSync(Path.dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Crypto.randomUUID()}.tmp`;
  try {
    const fd = Fs.openSync(tmp, 'wx');
    try {
      Fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      Fs.fsyncSync(fd);
    } finally {
      Fs.closeSync(fd);
    }
    Fs.renameSync(tmp, path);
  } finally {
    Fs.rmSync(tmp, { force: true });
  }
}
function localPath(outDir, path) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('positions/') ||
    path.includes('\\') ||
    path.split('/').some((p) => p === '..' || p === '')
  )
    throw new Error('Invalid positions path');
  return Path.join(outDir, path.slice(10));
}
async function verifyLocal(path, file) {
  if (!file || Fs.statSync(path).size !== file.bytes || (await sha256(path)) !== file.sha256)
    throw new Error(`Archive checksum/size mismatch: ${path}`);
}
async function publishedIndex(outDir) {
  const pointer = readJson(Path.join(outDir, 'index.json'), null);
  if (!pointer) return null;
  if (
    pointer.manifest_version !== MANIFEST_VERSION ||
    !/^positions\/manifests\/[a-f0-9]{64}\.json$/.test(pointer.path)
  )
    throw new Error('Invalid positions pointer');
  const path = localPath(outDir, pointer.path);
  await verifyLocal(path, pointer);
  const index = readJson(path);
  if (!Array.isArray(index.days)) throw new Error('Invalid positions index');
  return index;
}
async function publishIndex(manifest, outDir, save, now = Date.now(), previous = null) {
  const index = buildIndex(manifest, now, previous);
  // Validate every newly referenced file before making it public. Historical
  // committed files are immutable; retention checks them again before deletion.
  for (const entry of Object.values(manifest.days)) {
    if (!entry.verified || entry.committed) continue;
    await verifyLocal(localPath(outDir, entry.files.bus.path), entry.files.bus);
  }
  const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  const hash = Crypto.createHash('sha256').update(bytes).digest('hex');
  const file = { path: `positions/manifests/${hash}.json`, sha256: hash, bytes: bytes.length };
  const path = localPath(outDir, file.path);
  if (!Fs.existsSync(path)) writeJson(path, index);
  await verifyLocal(path, file);
  // Sole public commit point: both paths live on the same volume.
  writeJson(Path.join(outDir, 'index.json'), { manifest_version: MANIFEST_VERSION, ...file });
  manifest.published = file;
  for (const entry of Object.values(manifest.days)) if (entry.verified) entry.committed = true;
  save(manifest);
  return index;
}
async function withLock(path, action) {
  Fs.mkdirSync(Path.dirname(path), { recursive: true });
  let fd;
  try {
    fd = Fs.openSync(path, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize stale-lock recovery so a second contender cannot unlink the
    // replacement lock acquired by the first. A crashed recovery guard fails
    // closed for operator inspection rather than risking concurrent writers.
    const recovery = `${path}.recover`;
    const guard = Fs.openSync(recovery, 'wx');
    try {
      const pid = Number(Fs.readFileSync(path, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Archive lock requires inspection');
      try {
        process.kill(pid, 0);
        throw new Error('Archive already running');
      } catch (probe) {
        if (probe.code !== 'ESRCH') throw probe;
      }
      Fs.unlinkSync(path);
      fd = Fs.openSync(path, 'wx');
      Fs.writeFileSync(fd, `${process.pid}\n`);
      Fs.fsyncSync(fd);
    } finally {
      Fs.closeSync(guard);
      Fs.unlinkSync(recovery);
    }
  }
  try {
    Fs.writeFileSync(fd, `${process.pid}\n`);
    Fs.fsyncSync(fd);
    return await action();
  } finally {
    Fs.closeSync(fd);
    Fs.unlinkSync(path);
  }
}
async function archive({
  db,
  outDir,
  manifestPath,
  now = Date.now(),
  limit = 3,
  writer = exportDay,
  publish = publishIndex,
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 366)
    throw new Error('Invalid archive day limit');
  return withLock(`${manifestPath}.lock`, async () => {
    const previous = await publishedIndex(outDir);
    const manifest = readJson(manifestPath, null);
    if (!manifest && (previous || Fs.existsSync(Path.join(outDir, 'manifests'))))
      throw new Error('Missing archive state with published history');
    const state = manifest || { manifest_version: MANIFEST_VERSION, days: {} };
    if (state.manifest_version !== MANIFEST_VERSION || !state.days || Array.isArray(state.days))
      throw new Error('Invalid archive manifest');
    if (state.published && !previous) throw new Error('Missing published positions pointer');
    const publicDays = new Map((previous?.days || []).map((day) => [day.date, day.files.bus]));
    for (const date of publicDays.keys()) {
      if (!state.days[date]) throw new Error(`Missing state for published archive day ${date}`);
    }
    for (const [date, entry] of Object.entries(state.days)) {
      if (!verifiedDay(entry)) throw new Error(`Invalid archive state for ${date}`);
      const current = entry.files.bus;
      const published = publicDays.get(date);
      const matches =
        published &&
        ['path', 'sha256', 'bytes', 'rows'].every((key) => current[key] === published[key]);
      if (entry.committed && !matches)
        throw new Error(`Committed archive disagrees with published day ${date}`);
      // A crash after pointer rename can leave an uncommitted state receipt.
      if (matches) entry.committed = true;
    }
    const save = (value) => writeJson(manifestPath, value);
    db.exec(
      'CREATE TABLE IF NOT EXISTS positions_archive_pruned (date TEXT PRIMARY KEY, sha256 TEXT NOT NULL)',
    );
    for (const row of db.prepare('SELECT date, sha256 FROM positions_archive_pruned').all()) {
      const entry = state.days[row.date];
      if (!entry || entry.files?.bus?.sha256 !== row.sha256)
        throw new Error('Pruned archive metadata mismatch');
      entry.pruned = true;
      const { start, end } = dayBounds(row.date);
      if (
        db
          .prepare('SELECT 1 FROM bus_observations WHERE ts >= ? AND ts < ? LIMIT 1')
          .get(start, end)
      )
        throw new Error('Late observations in a pruned archive day require reconciliation');
    }
    const minimum = db.prepare('SELECT MIN(ts) AS ts FROM bus_observations').get().ts;
    state.start_date ||= minimum == null ? null : localDate(minimum);
    save(state);
    const today = localDate(now);
    const missing = [];
    for (
      let date = state.start_date;
      date && date < today && missing.length < limit;
      date = addDays(date, 1)
    )
      if (!state.days[date]?.verified) missing.push(date);
    const retained = Object.keys(state.days)
      .filter((date) => date < today && !state.days[date].pruned && !missing.includes(date))
      .sort();
    const ordered = [
      ...retained.filter((date) => date > (state.revision_cursor || '')),
      ...retained.filter((date) => date <= (state.revision_cursor || '')),
    ];
    const dates = [...missing, ...ordered.slice(0, limit - missing.length)];
    for (const date of dates) {
      const files = await writer(db, date, outDir);
      await verifyLocal(localPath(outDir, files.bus.path), files.bus);
      const prior = state.days[date];
      const unchanged =
        prior?.committed &&
        ['path', 'sha256', 'bytes', 'rows'].every((key) => prior.files.bus[key] === files.bus[key]);
      state.days[date] = unchanged ? prior : { files, verified: true, committed: false };
      if (!verifiedDay(state.days[date]))
        throw new Error(`Invalid archive file metadata for ${date}`);
      state.revision_cursor = date;
      save(state);
    }
    if (!state.start_date) return { days: 0, pruned: 0 };
    if (!previous || Object.values(state.days).some((entry) => !entry.committed))
      await publish(state, outDir, save, now, previous);
    const days = Number(process.env.TRANSIT_POSITION_RETENTION_DAYS || 7);
    if (!Number.isFinite(days) || days < 1) throw new Error('Invalid position retention');
    const cutoff = now - days * 86400000;
    let pruned = 0;
    for (const [date, entry] of Object.entries(state.days)) {
      const { start, end } = dayBounds(date);
      if (
        !dates.includes(date) ||
        entry.pruned ||
        !entry.committed ||
        !entry.verified ||
        end > cutoff
      )
        continue;
      await verifyLocal(localPath(outDir, entry.files.bus.path), entry.files.bus);
      db.transaction(() => {
        const rows = db
          .prepare('SELECT COUNT(*) AS n FROM bus_observations WHERE ts >= ? AND ts < ?')
          .get(start, end).n;
        if (rows !== entry.files.bus.rows) return;
        pruned += db
          .prepare('DELETE FROM bus_observations WHERE ts >= ? AND ts < ?')
          .run(start, end).changes;
        db.prepare(
          'INSERT OR REPLACE INTO positions_archive_pruned (date, sha256) VALUES (?, ?)',
        ).run(date, entry.files.bus.sha256);
        entry.pruned = true;
      })();
      save(state);
    }
    return { days: dates.length, pruned };
  });
}
module.exports = {
  readJson,
  writeJson,
  localPath,
  verifyLocal,
  publishedIndex,
  publishIndex,
  withLock,
  archive,
};
