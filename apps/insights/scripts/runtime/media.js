require('../../src/shared/env');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../../src/tarc/storage');
const { loadGtfs } = require('../../src/tarc/gtfs');
const { loadShapes } = require('../../src/tarc/bus/shapes');
const { renderBunchingMap } = require('../../src/tarc/map/busBunching');
const { renderGapMap } = require('../../src/tarc/map/busGap');
const { renderBusDisruptionMap } = require('../../src/tarc/map/busDisruption');
const { renderBusSpeedmap } = require('../../src/tarc/map/busSpeedmap');
const { renderBusCrowdingMap } = require('../../src/tarc/map/busCrowding');
const { renderCrossBunchingMap } = require('../../src/tarc/map/crossBunching');
const {
  captureBusBunchingHistoryVideo,
  captureBusGapHistoryVideo,
} = require('../../src/tarc/bus/video');
const bunchPost = require('../../src/tarc/bus/bunchingPost');
const gapPost = require('../../src/tarc/bus/gapPost');
const { savePreview } = require('../../src/tarc/shared/delivery');
const { description } = require('./export');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    `${file}.tmp`,
    typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data),
  );
  fs.renameSync(`${file}.tmp`, file);
}
function boundedPost(text, url) {
  const suffix = url ? `\n\n${url}` : '';
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const parts = [...segmenter.segment(text)].map((p) => p.segment);
  const suffixLength = [...segmenter.segment(suffix)].length;
  const available = Math.max(0, 300 - suffixLength);
  return `${parts.length > available ? `${parts.slice(0, Math.max(0, available - 1)).join('')}…` : text}${suffix}`;
}

function clipWindow(event, now) {
  return {
    start: event.first_seen - 5 * 60000,
    end: Math.min(now, (event.resolved || now) + 5 * 60000, event.first_seen + 15 * 60000),
  };
}

async function clusterImage(evidence, gtfs, shapes) {
  const routes = evidence.routes || [];
  const paths = new Map();
  for (const vehicle of evidence.vehicles || []) {
    const shapeId = gtfs.tripsById.get(vehicle.tripId)?.shape_id;
    if (shapeId && shapes.has(shapeId))
      paths.set(shapeId, {
        points: shapes.get(shapeId).points,
        groupIndex: routes.indexOf(vehicle.route),
      });
  }
  return renderCrossBunchingMap({
    points: evidence.vehicles.map((v) => ({
      lat: v.lat,
      lon: v.lon,
      label: v.vehicleId,
      groupIndex: routes.indexOf(v.route),
    })),
    legend: routes.map((route, groupIndex) => ({ label: `Route ${route}`, groupIndex })),
    title: 'Nearby buses on multiple routes',
    routePaths: [...paths.values()],
  });
}

const { createMediaQueue, RENDER_VERSION } = require('../../src/tarc/mediaQueue');
const { withRenderDiagnostics, errorCode } = require('../../src/tarc/map/diagnostics');

async function renderJob(job, db, dir) {
  const now = Date.now();
  const gtfs = loadGtfs(process.env.TARC_GTFS_DIR);
  const shapes = loadShapes(process.env.TARC_GTFS_DIR);
  const metadata = (diagnostics) => ({
    renderer_version: RENDER_VERSION,
    basemap: diagnostics.basemap,
    render_error: diagnostics.error,
    rendered_at: now,
  });
  if (['speedmap', 'crowding'].includes(job.kind)) {
    const { route, shapeId, result, generated_at } = job.payload;
    if (!shapes.has(shapeId)) throw new Error('shape unavailable');
    const render = job.kind === 'speedmap' ? renderBusSpeedmap : renderBusCrowdingMap;
    const diagnostics = await withRenderDiagnostics(() => render(shapes.get(shapeId), result.bins));
    const file = path.join(dir, 'analytics-media.json');
    const index = readJson(file, {});
    atomic(path.join(dir, `${job.key}.jpg`), diagnostics.value);
    index[job.key] = {
      route,
      kind: job.kind,
      shape_id: shapeId,
      image_url: `/data/media/${job.key}.jpg`,
      updated_at: now,
      generated_at,
      window_start: generated_at - 3600000,
      window_end: generated_at,
      summary: result.summary,
      sample_count: result.sampleCount,
      crowded_vehicle_count: result.crowdedVehicleCount ?? null,
      coverage: result.summary.covered / result.summary.bins,
      ...metadata(diagnostics),
    };
    atomic(file, index);
    return { quality: diagnostics.basemap, error: diagnostics.error };
  }
  const row = db.prepare('SELECT * FROM local_events WHERE id=?').get(job.payload.id);
  if (!row) return { quality: 'expired' };
  const evidence = JSON.parse(row.evidence);
  const route = gtfs.routes.find((r) => r.route_short_name === row.route);
  const shape =
    shapes.get(evidence.shapeId || row.direction) ||
    shapes.get(gtfs.trips.find((t) => t.route_id === route?.route_id)?.shape_id);
  if (!shape) throw new Error('shape unavailable');
  const file = path.join(dir, 'media-index.json');
  const index = readJson(file, {});
  const previous = index[row.id] || {};
  const ctx = {
    routeTitle: `Route ${row.route} — ${route?.route_long_name || ''}`.replace(/ — $/, ''),
  };
  if (job.kind === 'image') {
    const alt =
      row.source === 'bunching'
        ? bunchPost.buildAltText(evidence, ctx)
        : row.source === 'gap'
          ? gapPost.buildAltText(evidence, ctx)
          : description(row, evidence);
    const body =
      row.source === 'bunching'
        ? bunchPost.buildPostText(evidence, ctx)
        : row.source === 'gap'
          ? gapPost.buildPostText(evidence, ctx)
          : description(row, evidence);
    const baseUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const text = boundedPost(
      body,
      baseUrl ? `${baseUrl}/event/${encodeURIComponent(row.id)}` : null,
    );
    const diagnostics = await withRenderDiagnostics(() =>
      row.source === 'bunching'
        ? renderBunchingMap(evidence, shape, [], { title: ctx.routeTitle })
        : row.source === 'gap'
          ? renderGapMap(evidence, shape, [], { title: ctx.routeTitle })
          : row.source === 'cross-bunching'
            ? clusterImage(evidence, gtfs, shapes)
            : renderBusDisruptionMap(shape, { title: `${ctx.routeTitle}: ${row.source}` }),
    );
    atomic(path.join(dir, `${row.id}.jpg`), diagnostics.value);
    index[row.id] = {
      ...previous,
      image_url: `/data/media/${row.id}.jpg`,
      alt,
      created_at: previous.created_at || now,
      ...metadata(diagnostics),
    };
    atomic(file, index);
    savePreview({ text, alt, image: diagnostics.value, key: row.id });
    return { quality: diagnostics.basemap, error: diagnostics.error };
  }
  const window = clipWindow(row, now);
  const rows = db
    .prepare(
      'SELECT ts, vehicle_id AS vehicleId, trip_id AS tripId, route, lat, lon, speed FROM bus_observations WHERE route=? AND ts BETWEEN ? AND ? ORDER BY ts LIMIT 3000',
    )
    .all(row.route, window.start, window.end);
  const capture =
    row.source === 'bunching' ? captureBusBunchingHistoryVideo : captureBusGapHistoryVideo;
  const diagnostics = await withRenderDiagnostics(() =>
    capture(evidence, shape, rows, { gtfs, shapes }),
  );
  const video = diagnostics.value;
  index[row.id] = {
    ...previous,
    created_at: previous.created_at || now,
    video_checked: true,
    video_basemap: diagnostics.basemap,
    video_renderer_version: RENDER_VERSION,
  };
  if (video?.buffer) {
    atomic(path.join(dir, `${row.id}.mp4`), video.buffer);
    index[row.id].video_url = `/data/media/${row.id}.mp4`;
  }
  delete index[row.id].video_retry_after;
  atomic(file, index);
  return { quality: diagnostics.basemap || 'insufficient_history' };
}

async function main() {
  const db = storage.getDb();
  const queue = createMediaQueue(db);
  const dir = path.join(process.env.TRANSIT_WEB_DIR, 'media');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const job = queue.claim();
    if (job) {
      try {
        const result = await renderJob(job, db, dir);
        queue.finish(job, result);
        console.log(
          `Media job ${job.key}: ${result.quality || 'complete'}${result.error ? ` (${result.error})` : ''}`,
        );
      } catch (error) {
        const code = errorCode(error);
        queue.finish(job, { error: code });
        console.warn(`Media job ${job.key}: ${code}; attempt ${job.attempts}`);
      }
    }
    const indexFile = path.join(dir, 'media-index.json');
    const index = readJson(indexFile, {});
    let pruned = false;
    for (const [id, media] of Object.entries(index)) {
      if (media.created_at >= Date.now() - 90 * 86400000) continue;
      if (/^[\w.-]+$/.test(id))
        for (const ext of ['jpg', 'mp4'])
          fs.rmSync(path.join(dir, `${id}.${ext}`), { force: true });
      delete index[id];
      pruned = true;
    }
    if (pruned) atomic(indexFile, index);
    atomic(path.join(process.env.TRANSIT_STATE_DIR, 'media-queue-health.json'), queue.summary());
  } finally {
    storage.closeDb();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(`Media worker failed: ${errorCode(error)}`);
    process.exitCode = 1;
  });
module.exports = { main, renderJob, boundedPost, clipWindow };
