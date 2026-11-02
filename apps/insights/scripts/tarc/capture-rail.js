#!/usr/bin/env node
// Capture a raw TARC rail traindata snapshot to data/tarc/captures/.
// Requires TARC_TRAIN_KEY (loaded from .env). Saves the exact JSON body and
// prints a summary (tracked trains vs scheduled estimates) so a degraded feed
// is obvious at capture time. Run across service periods for the Phase 5
// fixture campaign (AM peak, midday, PM peak, evening, late night, weekend).
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });
const axios = require('axios');
const { RAIL_URL, parseTrainData } = require('../../src/tarc/rail/api');
const { saveCapture } = require('../../src/tarc/captureUtil');

async function main() {
  if (!process.env.TARC_TRAIN_KEY) throw new Error('TARC_TRAIN_KEY is not set (.env)');
  const { data } = await axios.get(RAIL_URL, {
    params: { apiKey: process.env.TARC_TRAIN_KEY },
    timeout: 20000,
    // Keep the raw bytes so the fixture is exactly what TARC served.
    transformResponse: (x) => x,
  });
  const buf = Buffer.from(data);
  const parsed = parseTrainData(JSON.parse(data));
  const byLine = {};
  for (const t of parsed.trains) byLine[t.line] = (byLine[t.line] || 0) + 1;
  const path = saveCapture('rail-traindata', '.json', buf);
  console.log(
    `Saved ${buf.length} bytes → ${path}\n` +
      `  rows=${parsed.arrivals.length} trackedTrains=${parsed.trains.length} ` +
      `(${Object.entries(byLine)
        .map(([l, n]) => `${l}:${n}`)
        .join(' ')}) ` +
      `scheduledRows=${parsed.scheduled.length}`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
