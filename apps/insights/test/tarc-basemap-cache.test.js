const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cachedBasemap, cacheKey } = require('../src/tarc/map/basemapCache');

test('cache reuses only matching basemaps and never caches renderer failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarc-basemap-'));
  const geometry = {
    centerLon: -85.75,
    centerLat: 38.25,
    zoom: 12,
    width: 1200,
    height: 1200,
    scale: 1,
  };
  let calls = 0;
  const render = async () => {
    calls++;
    return Buffer.from('street pixels');
  };
  try {
    await cachedBasemap(geometry, 'light', render, dir);
    await cachedBasemap({ ...geometry, lines: 'different overlay' }, 'light', render, dir);
    assert.equal(calls, 1);
    await cachedBasemap(geometry, 'dark', render, dir);
    await cachedBasemap({ ...geometry, scale: 2 }, 'light', render, dir);
    assert.equal(calls, 3);
    const moved = { ...geometry, centerLon: -85.8 };
    await assert.rejects(
      cachedBasemap(
        moved,
        'light',
        async () => {
          throw new Error('browser crashed');
        },
        dir,
      ),
    );
    await cachedBasemap(moved, 'light', render, dir);
    assert.equal(calls, 4);
    const file = path.join(dir, `${cacheKey(geometry, 'light')}.png`);
    await fs.utimes(file, new Date(0), new Date(0));
    await cachedBasemap(geometry, 'light', render, dir);
    assert.equal(calls, 5, 'expired basemaps refresh');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
