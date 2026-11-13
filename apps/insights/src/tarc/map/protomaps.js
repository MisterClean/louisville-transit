// Render Protomaps vector tiles for static social images with headless MapLibre.
// The browser stays local; only style, glyph and tile requests reach Protomaps.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { mapGeometry, overlaySvg } = require('./geometryBase');
const { cachedBasemap } = require('./basemapCache');

// MapLibre 6 ships ES modules. Keep their imports and worker on this local origin.
const maplibreAssets = new Map(
  ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs'].map((name) => [
    `/${name}`,
    readFileSync(require.resolve(`maplibre-gl/dist/${name}`)),
  ]),
);
const STYLES = new Set(['light', 'dark', 'white', 'grayscale', 'black']);

async function startMapServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const asset = maplibreAssets.get(request.url);
      if (asset) {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(asset);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#map{width:100%;height:100%;margin:0;background:#17212b}</style></head><body><div id="map"></div></body></html>',
      );
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }),
    );
  });
}

async function renderProtomaps(spec, key, timeoutMs = 30000) {
  const geometry = mapGeometry(spec);
  const style = STYLES.has(process.env.PROTOMAPS_STYLE) ? process.env.PROTOMAPS_STYLE : 'light';
  const base = await cachedBasemap(geometry, style, () =>
    renderBrowserBase(geometry, style, key, timeoutMs),
  );
  return sharp(base)
    .composite([{ input: overlaySvg(geometry, true) }])
    .png()
    .toBuffer();
}

async function renderBrowserBase(geometry, style, key, timeoutMs) {
  const { server, url } = await startMapServer();
  let browser;
  let page;
  let timer;
  let resourceStatus;
  try {
    browser = await chromium.launch({
      timeout: timeoutMs,
      headless: true,
      executablePath:
        process.env.PROTOMAPS_CHROMIUM_PATH ||
        (process.platform === 'linux' ? '/usr/bin/chromium' : undefined),
      args: [
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    });
    page = await browser.newPage({
      viewport: { width: geometry.width, height: geometry.height },
      deviceScaleFactor: geometry.scale,
    });
    page.on('response', (response) => {
      if (response.status() >= 400) resourceStatus = response.status();
    });
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.goto(url);
    await Promise.race([
      page.evaluate(
        async ({ centerLon, centerLat, zoom, key, style }) => {
          const { Map: MapLibreMap } = await import('/maplibre-gl.mjs');
          return new Promise((resolve, reject) => {
            const map = new MapLibreMap({
              container: 'map',
              style: `https://api.protomaps.com/styles/v5/${style}/en.json?key=${encodeURIComponent(key)}`,
              center: [centerLon, centerLat],
              zoom,
              interactive: false,
              attributionControl: false,
              fadeDuration: 0,
              preserveDrawingBuffer: true,
            });
            map.on('error', () => reject(new Error('Protomaps resource failed')));
            map.once('idle', resolve);
          });
        },
        { ...geometry, key, style },
      ),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Protomaps render timed out')), timeoutMs);
      }),
    ]);
    return await page.screenshot({ type: 'png' });
  } catch (error) {
    if (resourceStatus) throw new Error(`Protomaps http_${resourceStatus}`);
    throw error;
  } finally {
    clearTimeout(timer);
    await closeResources(page, browser, server);
  }
}

async function closeResources(page, browser, server) {
  // A crashed page must not prevent closing Chromium or its local asset server.
  try {
    if (page) await page.close();
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

module.exports = { renderProtomaps, startMapServer, closeResources };
