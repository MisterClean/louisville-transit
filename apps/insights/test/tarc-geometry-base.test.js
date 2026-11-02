const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { encode } = require('../src/shared/polyline');
const { decodePolyline, mapGeometry, renderGeometryBase } = require('../src/tarc/map/geometryBase');

test('credential-free maps retain actual GTFS geometry and the upstream viewport', async () => {
  const points = [
    [38.24, -85.76],
    [38.25, -85.75],
    [38.26, -85.74],
  ];
  const encoded = encode(points);
  assert.deepEqual(
    decodePolyline(encoded).map((p) => [p.lat, p.lon]),
    points,
  );
  const url = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/path-8+00d8ff(${encodeURIComponent(encoded)})/-85.75,38.25,12/600x600@2x?access_token=`;
  const geometry = mapGeometry(url);
  assert.match(geometry.lines, /300\.00,300\.00/);
  const metadata = await sharp(await renderGeometryBase(url)).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
});

test('geometry renderer bounds pixels and rejects malformed geometry', () => {
  assert.throws(
    () => mapGeometry('https://example.test/static/path-8+abc(foo)/auto/5000x5000@2x'),
    /budget/,
  );
  assert.throws(() => decodePolyline('_'), /Invalid/);
});
