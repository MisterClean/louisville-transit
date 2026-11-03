const sharp = require('sharp');
const { encode } = require('../../shared/polyline');
const { cumulativeDistances } = require('../../shared/geo');
const { colorForBusSpeed } = require('../bus/speedmap');
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

async function renderBusSpeedmap(shape, binSpeeds) {
  const points = shape.points;
  const cumDist = cumulativeDistances(points);
  const slices = sliceIntoSegments(points, cumDist, binSpeeds.length);
  // Thin dense GTFS shapes so the rendered overlays stay efficient.
  const fullEncoded = encodeURIComponent(
    encode(thinPolylinePoints(points).map((p) => [p.lat, p.lon])),
  );
  const overlays = [`path-${SPEEDMAP_HALO_STROKE}+${ROUTE_HALO_COLOR}(${fullEncoded})`];

  for (let i = 0; i < slices.length; i++) {
    if (slices[i].length < 2) continue;
    const encoded = encodeURIComponent(
      encode(thinPolylinePoints(slices[i], 30).map((p) => [p.lat, p.lon])),
    );
    overlays.push(`path-${SPEEDMAP_SEGMENT_STROKE}+${colorForBusSpeed(binSpeeds[i])}(${encoded})`);
  }

  const data = await renderStaticMap({ overlays, width: WIDTH, height: HEIGHT, padding: 30 });
  return sharp(data).jpeg({ quality: 85 }).toBuffer();
}

module.exports = { renderBusSpeedmap };
