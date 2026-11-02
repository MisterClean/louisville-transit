#!/usr/bin/env node
// Validate a bounded TARC bus feed before replacing the last usable schedule.
// Failed downloads or archives leave both the current directory and cache intact.
const Fs = require('node:fs');
const Path = require('node:path');
const { execFileSync } = require('node:child_process');
const axios = require('axios');
const { loadGtfs, routeMode } = require('../../src/tarc/gtfs');

const GTFS_URL = 'https://tarc.rideralerts.com/InfoPoint/gtfs-zip.ashx';
require('../../src/shared/env');
const DATA_DIR = process.env.TRANSIT_DATA_DIR || Path.join(__dirname, '..', '..', 'data', 'tarc');
const ZIP_PATH = Path.join(DATA_DIR, 'google_transit.zip');
const OUT_DIR = Path.join(DATA_DIR, 'gtfs');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function download() {
  if (Fs.existsSync(ZIP_PATH) && Date.now() - Fs.statSync(ZIP_PATH).mtimeMs < ONE_DAY_MS) {
    console.log('Using cached google_transit.zip (< 1 day old)');
    return ZIP_PATH;
  }
  console.log(`Downloading ${GTFS_URL} ...`);
  const { data } = await axios.get(GTFS_URL, {
    responseType: 'arraybuffer',
    timeout: 180000,
    maxContentLength: 32 * 1024 * 1024,
  });
  Fs.mkdirSync(DATA_DIR, { recursive: true });
  const candidate = `${ZIP_PATH}.pending`;
  Fs.writeFileSync(candidate, Buffer.from(data));
  console.log(`  ${(data.byteLength / 1024 / 1024).toFixed(1)} MB`);
  return candidate;
}

async function main() {
  Fs.mkdirSync(DATA_DIR, { recursive: true });
  const candidate = await download();
  const stage = Fs.mkdtempSync(Path.join(DATA_DIR, '.gtfs-stage-'));
  const previous = `${OUT_DIR}.previous`;
  let gtfs;
  try {
    const names = execFileSync('unzip', ['-Z', '-1', candidate], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
      .trim()
      .split('\n');
    if (
      !names.length ||
      names.length > 100 ||
      names.some((name) => !/^[A-Za-z0-9_-]+\.txt$/.test(name))
    )
      throw new Error('Unexpected GTFS archive paths');
    const listing = execFileSync('unzip', ['-l', candidate], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const entries = [
      ...listing.matchAll(/^\s*(\d+)\s+\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/gm),
    ];
    if (
      entries.length !== names.length ||
      entries.reduce((sum, entry) => sum + Number(entry[1]), 0) > 200 * 1024 * 1024
    )
      throw new Error('GTFS archive exceeds extraction budget');
    execFileSync('unzip', ['-o', candidate, '-d', stage], { stdio: 'ignore', timeout: 60000 });
    for (const name of names)
      if (!Fs.lstatSync(Path.join(stage, name)).isFile())
        throw new Error('GTFS contains a non-regular file');
    for (const name of ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt']) {
      if (!Fs.existsSync(Path.join(stage, name)) || Fs.statSync(Path.join(stage, name)).size === 0)
        throw new Error(`GTFS missing ${name}`);
    }
    gtfs = loadGtfs(stage);
    if (!gtfs.routes.length || !gtfs.trips.length || !gtfs.stops.length)
      throw new Error('GTFS contains no usable service');
    // Recover the prior release if a process stopped between the two renames.
    if (!Fs.existsSync(OUT_DIR) && Fs.existsSync(previous)) Fs.renameSync(previous, OUT_DIR);
    Fs.rmSync(previous, { recursive: true, force: true });
    if (Fs.existsSync(OUT_DIR)) Fs.renameSync(OUT_DIR, previous);
    try {
      Fs.renameSync(stage, OUT_DIR);
    } catch (error) {
      if (Fs.existsSync(previous)) Fs.renameSync(previous, OUT_DIR);
      throw error;
    }
    if (candidate !== ZIP_PATH) Fs.renameSync(candidate, ZIP_PATH);
    Fs.rmSync(previous, { recursive: true, force: true });
  } finally {
    Fs.rmSync(stage, { recursive: true, force: true });
    if (candidate !== ZIP_PATH) Fs.rmSync(candidate, { force: true });
  }
  const byMode = {};
  for (const r of gtfs.routes) {
    const m = routeMode(r);
    byMode[m] = (byMode[m] || 0) + 1;
  }
  console.log(`Extracted → ${OUT_DIR}`);
  console.log(
    `  routes=${gtfs.routes.length} (${Object.entries(byMode)
      .map(([m, n]) => `${m}:${n}`)
      .join(' ')}) trips=${gtfs.trips.length} stops=${gtfs.stops.length}`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
