const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('invalid static GTFS candidate preserves the previous usable directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-static-refresh-'));
  try {
    fs.mkdirSync(path.join(directory, 'gtfs'));
    fs.writeFileSync(path.join(directory, 'gtfs', 'routes.txt'), 'previous usable routes');
    fs.writeFileSync(path.join(directory, 'google_transit.zip'), 'not a zip archive');
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, '../scripts/tarc/fetch-static-gtfs.js')],
      {
        env: { ...process.env, TRANSIT_DATA_DIR: directory },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(
      fs.readFileSync(path.join(directory, 'gtfs', 'routes.txt'), 'utf8'),
      'previous usable routes',
    );
    assert.equal(
      fs.readdirSync(directory).some((name) => name.startsWith('.gtfs-stage-')),
      false,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
