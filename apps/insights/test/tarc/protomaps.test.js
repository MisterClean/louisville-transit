const test = require('node:test');
const assert = require('node:assert/strict');
const { startMapServer } = require('../../src/tarc/map/protomaps');

test('the local map server serves MapLibre modules and its worker', async () => {
  const { server, url } = await startMapServer();
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="map"/);

    for (const name of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs']) {
      const response = await fetch(new URL(name, url));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/javascript/);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
