const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  createMediaQueue,
  LEASE_MS,
  MAX_ATTEMPTS,
  RENDER_VERSION,
} = require('../src/tarc/mediaQueue');
const { enqueueMedia } = require('../scripts/runtime/media-enqueue');

test('queue persists across restart, deduplicates and recovers interrupted leases with bounded attempts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-queue-'));
  let db = new Database(path.join(dir, 'queue.sqlite'));
  let queue = createMediaQueue(db);
  const task = { key: 'image:01', kind: 'image', payload: { id: '01' }, revision: 2 };
  try {
    queue.enqueue(task, 1000);
    queue.enqueue(task, 2000);
    assert.equal(queue.summary().pending, 1);
    let job = queue.claim(2000);
    assert.equal(queue.claim(2001), null);
    db.close();
    db = new Database(path.join(dir, 'queue.sqlite'));
    queue = createMediaQueue(db);
    assert.equal(queue.claim(2002), null, 'unexpired claims cannot run twice');
    let now = 2000 + LEASE_MS;
    job = queue.claim(now);
    assert.equal(job.attempts, 2);
    queue.finish(job, { quality: 'degraded', error: 'browser_crash' }, now);
    queue.enqueue(task, now);
    assert.equal(queue.claim(now), null, 'enqueue does not bypass retry backoff');
    for (let attempt = 3; attempt <= MAX_ATTEMPTS; attempt++) {
      now += 3600000;
      job = queue.claim(now);
      assert.equal(job.attempts, attempt);
      queue.finish(job, { error: 'render_timeout' }, now);
    }
    queue.enqueue(task, now + 3600000);
    assert.equal(
      queue.claim(now + 3600000),
      null,
      'failed work is bounded, not re-created each poll',
    );
    assert.equal(queue.summary().failed, 1);
    queue.enqueue({ ...task, revision: 3 }, now + 3600000);
    assert.equal(
      queue.claim(now + 3600000).attempts,
      1,
      'new renderer version can repair failed media',
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fresh incidents outrank backfill; analytics cannot overwrite a claimed payload', () => {
  const db = new Database(':memory:');
  const queue = createMediaQueue(db);
  try {
    queue.enqueue({ key: 'old', kind: 'image', payload: {}, revision: 2, priority: 3 }, 0);
    queue.enqueue({ key: 'new', kind: 'image', payload: {}, revision: 2, priority: 0 }, 1);
    const job = queue.claim(2);
    assert.equal(job.key, 'new');
    assert.equal(queue.claim(2), null, 'a second worker cannot claim another job concurrently');
    queue.finish(job, { quality: 'street' }, 2);
    queue.enqueue(
      { key: 'speedmap-01', kind: 'speedmap', payload: { generated_at: 1 }, revision: '2:1' },
      3,
    );
    const analytics = queue.claim(3);
    queue.enqueue(
      { key: analytics.key, kind: analytics.kind, payload: { generated_at: 2 }, revision: '2:2' },
      4,
    );
    assert.equal(
      JSON.parse(
        db.prepare('SELECT payload FROM media_jobs WHERE key=?').get(analytics.key).payload,
      ).generated_at,
      1,
    );
    queue.finish(analytics, { quality: 'street' }, 5);
    queue.enqueue(
      { key: analytics.key, kind: analytics.kind, payload: { generated_at: 2 }, revision: '2:2' },
      6,
    );
    assert.equal(queue.claim(6).payload.generated_at, 2);
  } finally {
    db.close();
  }
});

test('enqueue repairs unversioned images without deleting cached media or posting state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-enqueue-'));
  const db = new Database(':memory:');
  try {
    db.exec(
      'CREATE TABLE local_events(id TEXT, source TEXT, first_seen INTEGER); CREATE TABLE local_analytics(key TEXT, payload TEXT); CREATE TABLE receipts(id TEXT);',
    );
    db.prepare('INSERT INTO local_events VALUES (?, ?, ?)').run('gap-01', 'gap', 1000);
    db.prepare('INSERT INTO local_events VALUES (?, ?, ?)').run('fresh-01', 'bunching', 2000);
    db.exec("INSERT INTO receipts VALUES ('sent')");
    const index = {
      'gap-01': { image_url: '/data/media/gap-01.jpg', video_url: '/data/media/gap-01.mp4' },
    };
    fs.writeFileSync(path.join(dir, 'media-index.json'), JSON.stringify(index));
    enqueueMedia(db, dir, 400000);
    const queue = createMediaQueue(db);
    const job = queue.claim(400000);
    assert.equal(job.key, 'image:fresh-01');
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM media_jobs WHERE key='video:gap-01'").get().n,
      0,
    );
    assert.equal(
      db.prepare("SELECT revision FROM media_jobs WHERE key='image:gap-01'").get().revision,
      String(RENDER_VERSION),
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'media-index.json'))), index);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
