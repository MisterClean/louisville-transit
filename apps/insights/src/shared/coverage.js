// Coverage is independent of incident occurrence. A sample joins the previous
// sample only across <=2 minutes; long outages contribute no observed time.
const TIMEZONE = 'America/New_York';
const DAY_MS = 86400000;
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function parts(ts) {
  return Object.fromEntries(formatter.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
}
function dayKey(ts) {
  const p = parts(ts);
  return `${p.year}-${p.month}-${p.day}`;
}
function midnight(day) {
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = target + 5 * 3600000;
  for (let i = 0; i < 3; i++) {
    const p = parts(guess);
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += target - local;
  }
  return guess;
}
function dayBounds(day) {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return { start: midnight(day), end: midnight(next) };
}
function ensureCoverage(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS observation_days(day TEXT PRIMARY KEY, covered_ms INTEGER NOT NULL DEFAULT 0, samples INTEGER NOT NULL DEFAULT 0, first_source_ts INTEGER NOT NULL,last_source_ts INTEGER NOT NULL)',
  );
}
function recordCoverage(db, sourceTs, previousTs) {
  ensureCoverage(db);
  const day = dayKey(sourceTs),
    bounds = dayBounds(day);
  const gap = sourceTs - previousTs;
  const covered =
    previousTs && gap > 0 && gap <= 120000
      ? Math.max(0, sourceTs - Math.max(previousTs, bounds.start))
      : 0;
  db.prepare(
    `INSERT INTO observation_days(day,covered_ms,samples,first_source_ts,last_source_ts) VALUES(?,?,1,?,?) ON CONFLICT(day) DO UPDATE SET covered_ms=covered_ms+excluded.covered_ms,samples=samples+1,last_source_ts=excluded.last_source_ts`,
  ).run(day, covered, sourceTs, sourceTs);
  // Split a short, observed interval across midnight without losing its old-day tail.
  if (previousTs && gap > 0 && gap <= 120000 && dayKey(previousTs) !== day) {
    const previousDay = dayKey(previousTs);
    db.prepare('UPDATE observation_days SET covered_ms=covered_ms+? WHERE day=?').run(
      bounds.start - previousTs,
      previousDay,
    );
  }
}
function coverageSummary(db, now = Date.now()) {
  ensureCoverage(db);
  const today = dayKey(now);
  const days = db
    .prepare('SELECT * FROM observation_days ORDER BY day')
    .all()
    .map((row) => {
      const b = dayBounds(row.day);
      const fraction = Math.min(1, row.covered_ms / (b.end - b.start));
      return { ...row, fraction, complete: row.day < today && fraction >= 0.95 };
    });
  return {
    definition:
      'A completed America/New_York day with at least 95% source-time coverage; consecutive independent samples may be at most 120 seconds apart. Outages add no coverage.',
    threshold: 0.95,
    complete_days: days.filter((d) => d.complete).map((d) => d.day),
    days,
  };
}
module.exports = { dayKey, dayBounds, recordCoverage, coverageSummary, ensureCoverage };
