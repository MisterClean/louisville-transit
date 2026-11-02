// Central dotenv loader so bin scripts don't each spell out the path to .env.
// Require this from any bin entrypoint before touching process.env.

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });

const path = require('node:path');
const data = process.env.TRANSIT_DATA_DIR || path.join(__dirname, '../../data/tarc');
const state = process.env.TRANSIT_STATE_DIR || path.join(__dirname, '../../state');
process.env.TARC_GTFS_DIR ||= path.join(data, 'gtfs');
process.env.TARC_SCHEDULE_INDEX_PATH ||= path.join(data, 'schedule-index.json');
process.env.TARC_SCHEDULE_DB_PATH ||= path.join(data, 'schedule.sqlite');
process.env.TARC_HISTORY_DB_PATH ||= path.join(state, 'tarc.sqlite');

process.env.TRANSIT_WEB_DIR ||= path.join(data, '../web');
