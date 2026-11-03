// Route overlays and credential-free fallback share one Web Mercator viewport.
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

function mapGeometry({ overlays = [], centerLon, centerLat, zoom, width = 1200, height = 1200, scale = 2, padding = 60 }) {
  if (width < 1 || height < 1 || width > 1280 || height > 1280 || scale < 1 || scale > 2) {
    throw new Error('Map exceeds pixel budget');
  }
  const paths = overlays.map((overlay) => {
    const match = /^path-([\d.]+)\+([\da-fA-F]{3,8})(?:-([\d.]+))?\(([^)]*)\)$/.exec(overlay);
    if (!match) throw new Error('Invalid map overlay');
    return {
      stroke: Number(match[1]),
      color: match[2],
      opacity: Number(match[3] || 1),
      points: decodePolyline(decodeURIComponent(match[4])),
    };
  });
  if (centerLon == null || centerLat == null || zoom == null) {
    const points = paths.flatMap((path) => path.points);
    if (!points.length) throw new Error('Map has no route geometry');
    const bbox = {
      minLat: Math.min(...points.map((p) => p.lat)),
      maxLat: Math.max(...points.map((p) => p.lat)),
      minLon: Math.min(...points.map((p) => p.lon)),
      maxLon: Math.max(...points.map((p) => p.lon)),
    };
    centerLat = (bbox.minLat + bbox.maxLat) / 2;
    centerLon = (bbox.minLon + bbox.maxLon) / 2;
    zoom = Math.min(17, fitZoom(bbox, width, height, padding));
  }
  if (![centerLon, centerLat, zoom].every(Number.isFinite)) throw new Error('Invalid map viewport');
  const lines = paths.map((path) => {
    const pixels = path.points.map((point) => project(point.lat, point.lon, centerLat, centerLon, zoom, width, height));
    return `<polyline points="${pixels.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}" fill="none" stroke="#${path.color}" stroke-width="${path.stroke}" opacity="${path.opacity}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  return { width, height, scale, centerLon, centerLat, zoom, lines };
}

function overlaySvg(geometry, credited) {
  const { width, height, scale, lines } = geometry;
  const credit = credited
    ? `<rect x="${width - 302}" y="${height - 40}" width="302" height="40" fill="#111b27" fill-opacity="0.88"/><text x="${width - 288}" y="${height - 14}" font-family="Arial,sans-serif" font-size="17" fill="#f1f5f8">© OpenStreetMap · Protomaps</text>`
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">${lines}${credit}</svg>`);
}

async function renderGeometryBase(spec) {
  const geometry = mapGeometry(spec);
  const { width, height, scale, lines } = geometry;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#171c25"/>${lines}<rect x="0" y="${height - 42}" width="${width}" height="42" fill="#10151e"/><text x="16" y="${height - 14}" font-family="Arial,sans-serif" font-size="20" fill="#f1f5f8">TARC route geometry · no street basemap</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { decodePolyline, mapGeometry, overlaySvg, renderGeometryBase };
