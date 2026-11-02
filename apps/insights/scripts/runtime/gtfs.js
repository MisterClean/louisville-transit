require('../../src/shared/env');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
for (const name of ['fetch-static-gtfs', 'build-schedule-index', 'build-schedule-stops']) {
  execFileSync(process.execPath, [path.join(__dirname, '../tarc', `${name}.js`)], {
    stdio: 'inherit',
    env: process.env,
  });
}
