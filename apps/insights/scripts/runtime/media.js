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
  } catch {
    return fallback;
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

async function main() {
  const db = storage.getDb();
  const dir = path.join(process.env.TRANSIT_WEB_DIR, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'media-index.json');
  const index = readJson(indexFile, {});
  const analyticsFile = path.join(dir, 'analytics-media.json');
  const analyticsMedia = readJson(analyticsFile, {});
  const gtfs = loadGtfs(process.env.TARC_GTFS_DIR);
  const shapes = loadShapes(process.env.TARC_GTFS_DIR);
  const now = Date.now();
  const events = db
    .prepare('SELECT * FROM local_events WHERE first_seen > ? ORDER BY first_seen DESC LIMIT 200')
    .all(now - 90 * 86400000);
  let rendered = 0;
  let videos = 0;
  let videoAttempts = 0;
  const baseUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  for (const row of events) {
    if (rendered >= 3) break;
    if (!/^[\w.-]+$/.test(row.id)) continue;
    const evidence = JSON.parse(row.evidence);
    const route = gtfs.routes.find((r) => r.route_short_name === row.route);
    const shape =
      shapes.get(evidence.shapeId || row.direction) ||
      shapes.get(gtfs.trips.find((t) => t.route_id === route?.route_id)?.shape_id);
    if (!shape) continue;
    const ctx = {
      routeTitle: `Route ${row.route} — ${route?.route_long_name || ''}`.replace(/ — $/, ''),
    };
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
    const text = boundedPost(
      body,
      baseUrl ? `${baseUrl}/event/${encodeURIComponent(row.id)}` : null,
    );
    try {
      if (!index[row.id]?.image_url) {
        const image =
          row.source === 'bunching'
            ? await renderBunchingMap(evidence, shape, [], { title: ctx.routeTitle })
            : row.source === 'gap'
              ? await renderGapMap(evidence, shape, [], { title: ctx.routeTitle })
              : row.source === 'cross-bunching'
                ? await clusterImage(evidence, gtfs, shapes)
                : await renderBusDisruptionMap(shape, {
                    title: `${ctx.routeTitle}: ${row.source}`,
                  });
        atomic(path.join(dir, `${row.id}.jpg`), image);
        index[row.id] = { image_url: `/data/media/${row.id}.jpg`, alt, created_at: now };
        savePreview({ text, alt, image, key: row.id });
        rendered++;
      }
      // One bounded clip per invocation. Browser replay stays available for all
      // incidents independently of these optional encoded social-media clips.
      if (
        !index[row.id].video_url &&
        !index[row.id].video_checked &&
        videoAttempts < 1 &&
        now - row.first_seen > 5 * 60000 &&
        ['bunching', 'gap'].includes(row.source)
      ) {
        videoAttempts++;
        const window = clipWindow(row, now);
        const rows = db
          .prepare(
            'SELECT ts, vehicle_id AS vehicleId, trip_id AS tripId, route, lat, lon, speed FROM bus_observations WHERE route=? AND ts BETWEEN ? AND ? ORDER BY ts LIMIT 3000',
          )
          .all(row.route, window.start, window.end);
        const capture =
          row.source === 'bunching' ? captureBusBunchingHistoryVideo : captureBusGapHistoryVideo;
        const video = await capture(evidence, shape, rows, { gtfs, shapes });
        if (video?.buffer) {
          atomic(path.join(dir, `${row.id}.mp4`), video.buffer);
          index[row.id].video_url = `/data/media/${row.id}.mp4`;
          videos++;
        }
        index[row.id].video_checked = true;
      }
    } catch (error) {
      console.warn(`Media unavailable for ${row.id}: ${error.message}`);
    }
  }
  const payload = db.prepare("SELECT payload FROM local_analytics WHERE key='bus'").get();
  const analytics = payload ? JSON.parse(payload.payload) : {};
  let maps = 0;
  for (const [kind, source, render] of [
    ['speedmap', analytics.speedmaps, renderBusSpeedmap],
    ['crowding', analytics.crowding, renderBusCrowdingMap],
  ]) {
    const chosen = new Map();
    for (const [shapeId, result] of source || []) {
      if (result.summary.covered / result.summary.bins < 0.3) continue;
      if (
        !chosen.has(result.route) ||
        result.summary.covered > chosen.get(result.route).result.summary.covered
      )
        chosen.set(result.route, { shapeId, result });
    }
    for (const [route, { shapeId, result }] of chosen) {
      if (maps >= 4) break;
      const key = `${kind}-${route}`;
      if (now - (analyticsMedia[key]?.updated_at || 0) < 3600000) continue;
      if (!/^[\w.-]+$/.test(key) || !shapes.has(shapeId)) continue;
      const image = await render(shapes.get(shapeId), result.bins);
      atomic(path.join(dir, `${key}.jpg`), image);
      analyticsMedia[key] = {
        route,
        kind,
        shape_id: shapeId,
        image_url: `/data/media/${key}.jpg`,
        updated_at: now,
        generated_at: analytics.generated_at,
        window_start: analytics.generated_at - 3600000,
        window_end: analytics.generated_at,
        summary: result.summary,
        sample_count: result.sampleCount,
        crowded_vehicle_count: result.crowdedVehicleCount ?? null,
        coverage: result.summary.covered / result.summary.bins,
      };
      maps++;
    }
  }
  // Media is a bounded cache. Source incidents, receipts and structured replay
  // retain their own independent history; removing a JPEG never erases events.
  for (const [id, media] of Object.entries(index)) {
    if (media.created_at >= now - 90 * 86400000) continue;
    if (/^[\w.-]+$/.test(id))
      for (const ext of ['jpg', 'mp4']) fs.rmSync(path.join(dir, `${id}.${ext}`), { force: true });
    delete index[id];
  }
  atomic(indexFile, index);
  atomic(analyticsFile, analyticsMedia);
  storage.closeDb();
  console.log(`Media: ${rendered} incident maps, ${videos} clips, ${maps} route maps`);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
module.exports = { main, boundedPost, clipWindow };
