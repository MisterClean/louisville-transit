// Runtime-only GTFS-realtime schema loader. Vendored official schema avoids
// shipping protoc, protobufjs-cli, or a generated-binding compiler toolchain.
const path = require('node:path');
const protobuf = require('protobufjs');
const root = protobuf.loadSync(path.join(__dirname, '../../vendor/gtfs-realtime.proto'));
const namespace = 'transit_realtime';
const type = (name) => root.lookupType(`${namespace}.${name}`);
const enumeration = (name) => root.lookupEnum(`${namespace}.${name}`).values;
const transit_realtime = {
  FeedMessage: type('FeedMessage'),
  FeedHeader: { Incrementality: enumeration('FeedHeader.Incrementality') },
  TripDescriptor: { ScheduleRelationship: enumeration('TripDescriptor.ScheduleRelationship') },
  TripUpdate: {
    StopTimeUpdate: {
      ScheduleRelationship: enumeration('TripUpdate.StopTimeUpdate.ScheduleRelationship'),
    },
  },
  VehiclePosition: { OccupancyStatus: enumeration('VehiclePosition.OccupancyStatus') },
  Alert: { Cause: enumeration('Alert.Cause'), Effect: enumeration('Alert.Effect') },
};
module.exports = { transit_realtime };
