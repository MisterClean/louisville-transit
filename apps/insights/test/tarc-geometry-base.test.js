const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { encode } = require('../src/shared/polyline');
const { decodePolyline, mapGeometry, renderGeometryBase } = require('../src/tarc/map/geometryBase');
const { renderStaticMap } = require('../src/tarc/map/common');

test('credential-free maps retain actual GTFS geometry and viewport', async () => {
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
  const spec = { overlays: [`path-8+00d8ff(${encodeURIComponent(encoded)})`], centerLon: -85.75, centerLat: 38.25, zoom: 12, width: 600, height: 600 };
  const geometry = mapGeometry(spec);
  assert.match(geometry.lines, /300\.00,300\.00/);
  const metadata = await sharp(await renderGeometryBase(spec)).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
});

test('geometry renderer bounds pixels and rejects malformed geometry', () => {
  assert.throws(
    () => mapGeometry({ width: 5000, height: 5000, overlays: [] }),
    /budget/,
  );
  assert.throws(() => decodePolyline('_'), /Invalid/);
});

test('provider failure keeps labeled route geometry', async () => {
  const oldKey = process.env.PROTOMAPS_KEY;
  process.env.PROTOMAPS_KEY = 'test-key';
  const spec = { overlays: ['path-8+00d8ff(_p~iF~ps|U_ulLnnqC_mqNvxq`@)'], width: 600, height: 600 };
  try {
    const fallback = await renderStaticMap(spec, 100, async () => { throw new Error('provider URL with key'); });
    const expected = await renderGeometryBase(spec);
    assert.deepEqual(fallback, expected);
  } finally {
    if (oldKey == null) delete process.env.PROTOMAPS_KEY;
    else process.env.PROTOMAPS_KEY = oldKey;
  }
});
