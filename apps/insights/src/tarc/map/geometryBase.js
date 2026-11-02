// Credential-free route geometry. Uses the same Mercator viewport and actual
// GTFS paths as the Mapbox renderer; the visible credit distinguishes this
// schematic from a street basemap. No external tile service is scraped.
const sharp = require('sharp');
const { fitZoom, project } = require('../../shared/projection');

function decodePolyline(encoded) {
  const points = [];
  let offset = 0;
  let lat = 0;
  let lon = 0;
  function next() {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      if (offset >= encoded.length || shift > 30) throw new Error('Invalid map polyline');
      byte = encoded.charCodeAt(offset++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid map polyline');
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  }
  while (offset < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 100000, lon: lon / 100000 });
  }
  return points;
}

function mapGeometry(url) {
  const parsed = new URL(url);
  const match = /\/static\/(.+)\/([^/]+)\/(\d+)x(\d+)(@2x)?$/.exec(parsed.pathname);
  if (!match) throw new Error('Unsupported static map viewport');
  const [, overlays, position, rawWidth, rawHeight, retina] = match;
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  const scale = retina ? 2 : 1;
  if (width < 1 || height < 1 || width > 1280 || height > 1280) {
    throw new Error('Map exceeds pixel budget');
  }
  const paths = [
    ...overlays.matchAll(/path-([\d.]+)\+([\da-fA-F]{3,8})(?:-([\d.]+))?\(([^)]*)\)/g),
  ].map((p) => ({
    stroke: Number(p[1]),
    color: p[2],
    opacity: Number(p[3] || 1),
    points: decodePolyline(decodeURIComponent(p[4])),
  }));
  let centerLat;
  let centerLon;
  let zoom;
  if (position === 'auto') {
    const points = paths.flatMap((p) => p.points);
    if (!points.length) throw new Error('Map has no route geometry');
    const bbox = {
      minLat: Math.min(...points.map((p) => p.lat)),
      maxLat: Math.max(...points.map((p) => p.lat)),
      minLon: Math.min(...points.map((p) => p.lon)),
      maxLon: Math.max(...points.map((p) => p.lon)),
    };
    centerLat = (bbox.minLat + bbox.maxLat) / 2;
    centerLon = (bbox.minLon + bbox.maxLon) / 2;
    zoom = Math.min(17, fitZoom(bbox, width, height, 60));
  } else {
    [centerLon, centerLat, zoom] = position.split(',').map(Number);
    if (![centerLon, centerLat, zoom].every(Number.isFinite))
      throw new Error('Invalid map viewport');
  }
  const lines = paths
    .map((p) => {
      const pixels = p.points.map((v) =>
        project(v.lat, v.lon, centerLat, centerLon, zoom, width, height),
      );
      return `<polyline points="${pixels.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ')}" fill="none" stroke="#${p.color}" stroke-width="${p.stroke}" opacity="${p.opacity}" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join('');
  return { width, height, scale, lines };
}

async function renderGeometryBase(url) {
  const { width, height, scale, lines } = mapGeometry(url);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#171c25"/>${lines}<rect x="0" y="${height - 38}" width="${width}" height="38" fill="#10151e"/><text x="16" y="${height - 13}" font-family="Arial,sans-serif" font-size="17" fill="#b9c5d6">TARC route geometry · no street basemap</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { decodePolyline, mapGeometry, renderGeometryBase };
