const sharp = require('sharp');
const { encode } = require('../../shared/polyline');
const { cumulativeDistances } = require('../../shared/geo');
const { colorForRailSpeed } = require('../rail/speedmap');
const {
  WIDTH,
  HEIGHT,
  ROUTE_HALO_COLOR,
  SPEEDMAP_SEGMENT_STROKE,
  SPEEDMAP_HALO_STROKE,
  sliceIntoSegments,
  renderStaticMap,
  thinPolylinePoints,
} = require('./common');

// `colorFn` maps a bin's mph to a hex color; the streetcar passes its own so the
// slower bands paint correctly (same 5-color scheme, lower thresholds).
async function renderRailSpeedmap(line, binSpeeds, { colorFn = colorForRailSpeed } = {}) {
  const points = line.points;
  const cumDist = cumulativeDistances(points);
  const slices = sliceIntoSegments(points, cumDist, binSpeeds.length);
  const fullEncoded = encodeURIComponent(
    encode(thinPolylinePoints(points).map((p) => [p.lat, p.lon])),
  );
  const overlays = [`path-${SPEEDMAP_HALO_STROKE}+${ROUTE_HALO_COLOR}(${fullEncoded})`];

  for (let i = 0; i < slices.length; i++) {
    if (slices[i].length < 2) continue;
    const encoded = encodeURIComponent(
      encode(thinPolylinePoints(slices[i], 30).map((p) => [p.lat, p.lon])),
    );
    overlays.push(`path-${SPEEDMAP_SEGMENT_STROKE}+${colorFn(binSpeeds[i])}(${encoded})`);
  }

  const data = await renderStaticMap({ overlays, width: WIDTH, height: HEIGHT, padding: 30 });
  return sharp(data).jpeg({ quality: 85 }).toBuffer();
}

module.exports = { renderRailSpeedmap };
