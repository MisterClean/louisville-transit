// One durable queue on the existing WAL database. Claims hold no transaction
// during rendering. A killed worker's lease expires, including across deploys.
const RENDER_VERSION = 2;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 180000; // longer than the runtime's 120s worker deadline

function createMediaQueue(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS media_jobs (
    key TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
    revision TEXT NOT NULL, priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL, lease_until INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    last_error TEXT, quality TEXT
  );
  CREATE INDEX IF NOT EXISTS media_jobs_ready ON media_jobs(status, next_at, priority);
  CREATE TABLE IF NOT EXISTS media_render_counts(outcome TEXT PRIMARY KEY, count INTEGER NOT NULL);`);
  return {
    enqueue({ key, kind, payload, revision, priority = 1 }, now = Date.now()) {
      // Coalesce analytics updates while a job is pending/running; never replace
      // the payload of an active claim. A later poll picks up the newest data.
      db.prepare(`INSERT INTO media_jobs
        (key, kind, payload, revision, priority, next_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, revision=excluded.revision,
          priority=excluded.priority, status='pending', attempts=0,
          next_at=excluded.next_at, lease_until=NULL, updated_at=excluded.updated_at,
          last_error=NULL, quality=NULL
        WHERE media_jobs.status IN ('done','failed') AND media_jobs.revision != excluded.revision`).run(
        key,
        kind,
        JSON.stringify(payload),
        String(revision),
        priority,
        now,
        now,
        now,
      );
    },
    claim(now = Date.now()) {
      return db
        .transaction(() => {
          db.prepare(`UPDATE media_jobs SET status=CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
          last_error='worker_interrupted', lease_until=NULL, updated_at=?
          WHERE status='running' AND lease_until <= ?`).run(MAX_ATTEMPTS, now, now);
          if (db.prepare("SELECT 1 FROM media_jobs WHERE status='running' LIMIT 1").get())
            return null;
          const row = db
            .prepare(`SELECT * FROM media_jobs WHERE status='pending' AND next_at <= ?
          ORDER BY priority, created_at, key LIMIT 1`)
            .get(now);
          if (!row) return null;
          db.prepare(`UPDATE media_jobs SET status='running', attempts=attempts+1,
          lease_until=?, updated_at=? WHERE key=?`).run(now + LEASE_MS, now, row.key);
          return { ...row, payload: JSON.parse(row.payload), attempts: row.attempts + 1 };
        })
        .immediate();
    },
    finish(job, { quality = null, error = null } = {}, now = Date.now()) {
      const retry = error && job.attempts < MAX_ATTEMPTS;
      db.transaction(() => {
        const changed = db
          .prepare(`UPDATE media_jobs SET status=?, next_at=?, lease_until=NULL,
          updated_at=?, last_error=?, quality=? WHERE key=? AND status='running' AND attempts=?`)
          .run(
            error ? (retry ? 'pending' : 'failed') : 'done',
            now + (retry ? Math.min(3600000, 60000 * 2 ** (job.attempts - 1)) : 0),
            now,
            error,
            quality,
            job.key,
            job.attempts,
          );
        if (changed.changes)
          db.prepare(`INSERT INTO media_render_counts VALUES (?, 1)
          ON CONFLICT(outcome) DO UPDATE SET count=count+1`).run(error || quality || 'complete');
      }).immediate();
    },
    summary(now = Date.now()) {
      const counts = { pending: 0, running: 0, done: 0, failed: 0 };
      for (const row of db
        .prepare('SELECT status, COUNT(*) AS count FROM media_jobs GROUP BY status')
        .all())
        counts[row.status] = row.count;
      const oldest = db
        .prepare(
          "SELECT MIN(created_at) AS ts FROM media_jobs WHERE status IN ('pending','running')",
        )
        .get().ts;
      const errors = db
        .prepare(
          'SELECT last_error AS code, COUNT(*) AS count FROM media_jobs WHERE last_error IS NOT NULL GROUP BY last_error',
        )
        .all();
      const quality = db
        .prepare(
          'SELECT quality, COUNT(*) AS count FROM media_jobs WHERE quality IS NOT NULL GROUP BY quality',
        )
        .all();
      return {
        updated_at: now,
        renderer_version: RENDER_VERSION,
        ...counts,
        oldest_pending_at: oldest,
        errors,
        quality,
        outcomes: Object.fromEntries(
          db
            .prepare('SELECT outcome, count FROM media_render_counts')
            .all()
            .map((row) => [row.outcome, row.count]),
        ),
      };
    },
    prune(now = Date.now()) {
      db.prepare("DELETE FROM media_jobs WHERE status != 'running' AND updated_at < ?").run(
        now - 90 * 86400000,
      );
    },
  };
}
module.exports = { createMediaQueue, RENDER_VERSION, MAX_ATTEMPTS, LEASE_MS };
