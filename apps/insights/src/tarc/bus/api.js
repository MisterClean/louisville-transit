// TARC bus GTFS-realtime adapter. Public InfoPoint VehiclePosition and
// TripUpdate feeds require no API key. Canonical joins use trip_id and static
// route_id; public labels such as 01 remain separate string display values.
// Static trips supply direction and shape. Vehicle positions supply metres/sec
// speed, optional bearing and occupancy, and source timestamps. Missing scalar
// fields stay unknown. Trip updates supply explicit delay seconds and predicted
// arrival/departure epochs; these are predictions, not verified arrivals.
// Vehicle descriptors may omit start_date; the collector enriches service-date
// context from the matching trip update. Parsers remain pure for fixture tests.
const axios = require('axios');
const GtfsRt = require('../../shared/gtfsRealtime');
const { withRetry } = require('../../shared/retry');

const VEHICLE_POSITIONS_URL =
  'https://tarc.rideralerts.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition';
const TRIP_UPDATES_URL =
  'https://tarc.rideralerts.com/InfoPoint/GTFS-Realtime.ashx?Type=TripUpdate';

const { transit_realtime } = GtfsRt;
const FeedMessage = transit_realtime.FeedMessage;

// protobufjs decodes 64-bit fields as Long objects; everything downstream wants
// plain numbers (epoch seconds). Null-safe.
function longToNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function reverseEnum(enumObj) {
  const out = {};
  for (const [name, val] of Object.entries(enumObj)) out[val] = name;
  return out;
}
const TRIP_REL = reverseEnum(transit_realtime.TripDescriptor.ScheduleRelationship);
const STOP_REL = reverseEnum(transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship);
const OCCUPANCY = reverseEnum(transit_realtime.VehiclePosition.OccupancyStatus);
const relName = (map, v) => (v == null ? null : (map[v] ?? String(v)));

// protobufjs sets unset scalar fields to their type default (0) on the message
// PROTOTYPE, so a plain read can't tell "0 on the wire" from "absent." We only
// want only values actually transmitted, so gate on own-property presence
// and finiteness rather than treating an omitted field as an observed zero.
function wireNum(msg, key) {
  if (!msg || !Object.hasOwn(msg, key)) return null;
  const v = msg[key];
  return Number.isFinite(v) ? v : null;
}

function decodeFeed(buffer) {
  return FeedMessage.decode(new Uint8Array(buffer));
}

// --- Normalizers (pure; one per entity type) ---

function parseVehiclePosition(entity) {
  const v = entity.vehicle;
  if (!v) return null;
  const trip = v.trip || {};
  const pos = v.position || {};
  return {
    entityId: entity.id ?? null,
    tripId: trip.tripId ?? null,
    // Static route ID from the realtime feed; resolve through static GTFS.
    realtimeRouteId: trip.routeId ?? null,
    startDate: trip.startDate ?? null,
    scheduleRelationship: relName(TRIP_REL, trip.scheduleRelationship),
    vehicleId: v.vehicle?.id ?? null,
    label: v.vehicle?.label ?? null,
    lat: Number.isFinite(pos.latitude) ? pos.latitude : null,
    lon: Number.isFinite(pos.longitude) ? pos.longitude : null,
    bearing: wireNum(pos, 'bearing'),
    // Metres/second; absent is unknown, not stopped.
    speed: wireNum(pos, 'speed'),
    occupancy: Object.hasOwn(v, 'occupancyStatus') ? relName(OCCUPANCY, v.occupancyStatus) : null,
    ts: longToNum(v.timestamp),
  };
}

function parseTripUpdate(entity) {
  const tu = entity.tripUpdate;
  if (!tu) return null;
  const trip = tu.trip || {};
  return {
    entityId: entity.id ?? null,
    tripId: trip.tripId ?? null,
    realtimeRouteId: trip.routeId ?? null,
    startTime: trip.startTime ?? null,
    startDate: trip.startDate ?? null,
    scheduleRelationship: relName(TRIP_REL, trip.scheduleRelationship),
    vehicleId: tu.vehicle?.id ?? null,
    label: tu.vehicle?.label ?? null,
    timestamp: longToNum(tu.timestamp),
    stopUpdates: (tu.stopTimeUpdate || []).map((s) => {
      const arrivalTime = longToNum(s.arrival?.time);
      const arrivalScheduledTime = longToNum(s.arrival?.scheduledTime);
      return {
        stopSequence: Number.isFinite(s.stopSequence) ? s.stopSequence : null,
        stopId: s.stopId ?? null,
        scheduleRelationship: relName(STOP_REL, s.scheduleRelationship),
        arrivalTime,
        arrivalScheduledTime,
        departureTime: longToNum(s.departure?.time),
        departureScheduledTime: longToNum(s.departure?.scheduledTime),
        // Prefer predicted minus scheduled when available, otherwise explicit delay.
        // Positive = late. Null when either side is missing.
        scheduleDeviationSec:
          arrivalTime != null && arrivalScheduledTime != null
            ? arrivalTime - arrivalScheduledTime
            : (wireNum(s.arrival, 'delay') ?? wireNum(s.departure, 'delay')),
      };
    }),
  };
}

// --- Public fetchers (pure-ish: fetch + decode + normalize, no DB writes) ---

async function fetchBuffer(url, label) {
  const { data } = await withRetry(
    () => axios.get(url, { responseType: 'arraybuffer', timeout: 15000 }),
    { label },
  );
  return Buffer.from(data);
}

// Record to the TARC history DB by default; pass { record: false } for
// diagnostic fetches that shouldn't write. storage is required lazily so the
// pure-parser path (tests, capture scripts) never opens a DB.
async function getVehiclePositions({ record = true } = {}) {
  const feed = decodeFeed(await fetchBuffer(VEHICLE_POSITIONS_URL, 'TARC bus VehiclePositions'));
  const vehicles = (feed.entity || []).map(parseVehiclePosition).filter(Boolean);
  if (record) require('../storage').recordBusObservations(vehicles);
  return { feedTimestamp: longToNum(feed.header?.timestamp), vehicles };
}

async function getTripUpdates({ record = true } = {}) {
  const feed = decodeFeed(await fetchBuffer(TRIP_UPDATES_URL, 'TARC bus TripUpdates'));
  const tripUpdates = (feed.entity || []).map(parseTripUpdate).filter(Boolean);
  if (record) require('../storage').recordBusTripUpdates(tripUpdates);
  return { feedTimestamp: longToNum(feed.header?.timestamp), tripUpdates };
}

module.exports = {
  VEHICLE_POSITIONS_URL,
  TRIP_UPDATES_URL,
  getVehiclePositions,
  getTripUpdates,
  // Exposed for fixture-based tests (decode from a buffer, no network).
  decodeFeed,
  parseVehiclePosition,
  parseTripUpdate,
};
