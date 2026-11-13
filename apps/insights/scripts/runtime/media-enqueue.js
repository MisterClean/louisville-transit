require('../../src/shared/env');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../../src/tarc/storage');
const { createMediaQueue, RENDER_VERSION } = require('../../src/tarc/mediaQueue');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
function enqueueMedia(db, dir, now = Date.now()) {
  const queue = createMediaQueue(db);
  const index = readJson(path.join(dir, 'media-index.json'));
  const analyticsMedia = readJson(path.join(dir, 'analytics-media.json'));
  const events = db
    .prepare(
      'SELECT id, source, first_seen FROM local_events WHERE first_seen > ? ORDER BY first_seen DESC LIMIT 200',
    )
    .all(now - 90 * 86400000);
  for (const event of events) {
    if (!/^[\w.-]+$/.test(event.id)) continue;
    const media = index[event.id];
    if (
      !media?.image_url ||
      media.renderer_version !== RENDER_VERSION ||
      media.basemap === 'degraded'
    )
      queue.enqueue(
        {
          key: `image:${event.id}`,
          kind: 'image',
          payload: { id: event.id },
          revision: RENDER_VERSION,
          priority: media?.image_url ? 2 : 0,
        },
        now,
      );
    if (
      !media?.video_url &&
      !media?.video_checked &&
      now - event.first_seen > 5 * 60000 &&
      ['bunching', 'gap'].includes(event.source)
    )
      queue.enqueue(
        {
          key: `video:${event.id}`,
          kind: 'video',
          payload: { id: event.id },
          revision: RENDER_VERSION,
          priority: 3,
        },
        now,
      );
  }
  const payload = db.prepare("SELECT payload FROM local_analytics WHERE key='bus'").get();
  const analytics = payload ? JSON.parse(payload.payload) : {};
  for (const [kind, source] of [
    ['speedmap', analytics.speedmaps],
    ['crowding', analytics.crowding],
  ]) {
    const chosen = new Map();
    for (const [shapeId, result] of source || []) {
      if (!(result.summary.covered / result.summary.bins >= 0.3)) continue;
      if (
        !chosen.has(result.route) ||
        result.summary.covered > chosen.get(result.route).result.summary.covered
      )
        chosen.set(result.route, { shapeId, result });
    }
    for (const [route, { shapeId, result }] of chosen) {
      const key = `${kind}-${route}`;
      if (!/^[\w.-]+$/.test(key)) continue;
      if (
        analyticsMedia[key]?.renderer_version === RENDER_VERSION &&
        now - analyticsMedia[key].updated_at < 3600000
      )
        continue;
      queue.enqueue(
        {
          key,
          kind,
          payload: { route, shapeId, result, generated_at: analytics.generated_at },
          revision: `${RENDER_VERSION}:${Math.floor(analytics.generated_at / 3600000)}`,
          priority: 1,
        },
        now,
      );
    }
  }
  queue.prune(now);
}
if (require.main === module) {
  try {
    enqueueMedia(storage.getDb(), path.join(process.env.TRANSIT_WEB_DIR, 'media'));
  } finally {
    storage.closeDb();
  }
}
module.exports = { enqueueMedia };
