#!/usr/bin/env node
require('../../src/shared/env');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const { parseArgs } = require('node:util');
const Database = require('better-sqlite3');
const { dayBounds, localDate } = require('../../src/tarc/positionsArchive');
const { writeDay } = require('../../src/tarc/positionsParquet');

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      check: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      date: { type: 'string' },
      'limit-rows': { type: 'string' },
      limit: { type: 'string' },
    },
  });
  if (values.check) return { check: 'imports resolved' };
  if (values['dry-run']) {
    if (values.limit) throw new Error('Use --limit-rows for a dry run');
    const date = values.date || localDate(Date.now());
    const { start, end } = dayBounds(date);
    const limit = positiveInteger(values['limit-rows'], '--limit-rows', 5000);
    // The live database is always read-only. Samples can include today's
    // partial day, but never enter the public archive or retention ledger.
    const db = new Database(process.env.TARC_HISTORY_DB_PATH, { readonly: true });
    const outDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tarc-positions-sample-'));
    try {
      const rows = db
        .prepare(
          'SELECT * FROM bus_observations WHERE ts >= ? AND ts < ? ORDER BY ts, route, vehicle_id, rowid LIMIT ?',
        )
        .iterate(start, end, limit);
      const files = await writeDay(rows, date, outDir);
      return {
        dry_run: true,
        published: false,
        source_read_only: true,
        date,
        limit_rows: limit,
        output_directory: outDir,
        files,
      };
    } catch (error) {
      Fs.rmSync(outDir, { recursive: true, force: true });
      throw error;
    } finally {
      db.close();
    }
  }
  if (values.date || values['limit-rows'])
    throw new Error(
      '--date and --limit-rows require --dry-run; publication only includes completed days',
    );
  const storage = require('../../src/tarc/storage');
  try {
    const limit = positiveInteger(values.limit, '--limit');
    return await require('../../scripts/runtime/archive').run(limit === undefined ? {} : { limit });
  } finally {
    storage.closeDb();
  }
}

if (require.main === module)
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });

module.exports = { main };
