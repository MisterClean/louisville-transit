const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const TTL_MS = 7 * 86400000;
const MAX_BYTES = 64 * 1024 * 1024;

function cacheKey(geometry, style) {
  const { centerLon, centerLat, zoom, width, height, scale } = geometry;
  // Routes/markers are composited after cache retrieval; never cache overlays.
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 2,
        maplibre: '6.4.1',
        style,
        centerLon,
        centerLat,
        zoom,
        width,
        height,
        scale,
      }),
    )
    .digest('hex');
}
async function cachedBasemap(
  geometry,
  style,
  render,
  directory = process.env.TRANSIT_STATE_DIR && path.join(process.env.TRANSIT_STATE_DIR, 'basemaps'),
  now = Date.now(),
) {
  if (!directory) return render();
  const filename = path.join(directory, `${cacheKey(geometry, style)}.png`);
  try {
    const info = await fs.stat(filename);
    if (now - info.mtimeMs < TTL_MS) return await fs.readFile(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Basemap cache read unavailable');
  }
  const image = await render();
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(`${filename}.tmp`, image);
    await fs.rename(`${filename}.tmp`, filename);
    const entries = [];
    for (const name of await fs.readdir(directory)) {
      if (!/^[a-f0-9]{64}\.png(?:\.tmp)?$/.test(name)) continue;
      const file = path.join(directory, name);
      const info = await fs.stat(file);
      entries.push({ file, ...info });
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let bytes = 0;
    for (const entry of entries) {
      bytes += entry.size;
      if (bytes > MAX_BYTES || now - entry.mtimeMs >= TTL_MS)
        await fs.rm(entry.file, { force: true });
    }
  } catch {
    console.warn('Basemap cache write unavailable');
  }
  return image;
}
module.exports = { cachedBasemap, cacheKey };
