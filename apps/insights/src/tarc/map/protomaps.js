// Render Protomaps vector tiles for static social images with headless MapLibre.
// The browser stays local; only style, glyph and tile requests reach Protomaps.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { mapGeometry, overlaySvg } = require('./geometryBase');

const maplibreScript = readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.js'));
const STYLES = new Set(['light', 'dark', 'white', 'grayscale', 'black']);

async function startMapServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.url === '/maplibre.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(maplibreScript);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta charset="utf-8"><style>html,body,#map{width:100%;height:100%;margin:0;background:#17212b}</style></head><body><div id="map"></div><script src="/maplibre.js"></script></body></html>');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function renderProtomaps(spec, key, timeoutMs = 30000) {
  const geometry = mapGeometry(spec);
  const style = STYLES.has(process.env.PROTOMAPS_STYLE) ? process.env.PROTOMAPS_STYLE : 'light';
  const { server, url } = await startMapServer();
  let browser;
  let page;
  let timer;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PROTOMAPS_CHROMIUM_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : undefined),
      args: ['--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    page = await browser.newPage({
      viewport: { width: geometry.width, height: geometry.height },
      deviceScaleFactor: geometry.scale,
    });
    await page.goto(url);
    await Promise.race([
      page.evaluate(({ centerLon, centerLat, zoom, key, style }) => new Promise((resolve, reject) => {
        const map = new maplibregl.Map({
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
      }), { ...geometry, key, style }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Protomaps render timed out')), timeoutMs); }),
    ]);
    const base = await page.screenshot({ type: 'png' });
    return sharp(base).composite([{ input: overlaySvg(geometry, true) }]).png().toBuffer();
  } finally {
    clearTimeout(timer);
    if (page) await page.close();
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { renderProtomaps };
