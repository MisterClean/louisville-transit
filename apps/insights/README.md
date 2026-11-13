# Louisville TARC insights producer

Independent bus analytics for TARC, adapted from Cailin Pitt's Atlanta and Chicago transit-insights producers. The production entrypoints are **only** `scripts/runtime/{gtfs,observe,detect,export}.js`; Railway's monorepo scheduler runs them sequentially. Louisville has 14 bus routes and no applicable rail/streetcar mode.

No TARC API key, Bluesky account, Protomaps key, R2 account, or GitHub dispatch token is required for collection, detection, archive, or replay. Public publishing is disabled unless `TRANSIT_PUBLISH_ENABLED=true`; account DIDs must be pinned before delivery.

## Operations

Set `TRANSIT_DATA_DIR` (schedule root, extracted GTFS under `gtfs/`), `TRANSIT_STATE_DIR` (SQLite and health), and `TRANSIT_WEB_DIR` (atomic frontend JSON exports). Production defaults are `/data/gtfs`, `/data/state`, and `/data/web` supplied by the runtime. Then run `npm run gtfs`, `npm run observe`, `npm run detect`, and `npm run export`. `gtfs` downloads at most daily, builds the exact-service schedule index, and builds schedule stop curves. The observer fetches one shared VehiclePosition/TripUpdate/Alert snapshot each cycle with bounded retries; the runtime controls cadence.

Canonical IDs are static string route IDs; rider labels preserve leading zeroes such as `01`. All service-day calculations use `America/New_York`, `calendar_dates` exceptions, sparse stop sequences, and service-day times beyond 24:00. Shape distances are inferred from geometry because GTFS units are unspecified (TARC's observed values are feet). Trip-update adherence uses explicit predicted delay, not an assertion that a bus actually arrived.

## Applicable feature coverage

The producer executes upstream pure bus detectors for bunching, gaps, ghosts, cross-route bunching, thin service gaps, and pulse blackouts. It records explicit canceled trips, correlates concurrent detector signals, exports speedmaps and categorical crowding, predicted schedule adherence, and per-direction scheduled headways. Official alerts preserve useful header-only content and clear only after three independent successful missing snapshots. No transport error resolves an alert.

`local_events` holds stable episodes, evidence, and three-tick resolution independently of social posting. Repeated source headers cannot advance detection or clear episodes. Cold-start, stale-feed, sample-count, and history-window gates suppress unsupported absence claims. `/data/health.json` exposes source freshness, real archive start, detector timestamp, observation coverage, and per-feature readiness. No synthetic historical incidents are seeded.

The archive exports upstream schema-v2 recent/monthly/per-route shards, index, daily counts, aggregates, and live positions. `analytics.json` supplies raw analytics to the frontend. `routes.json` carries actual GTFS geometry. `tracks/<event-id>.json` stores bus positions and shape geometry for eligible incident replay, requiring at least two independent timestamps. Finalized tracks are retained; only active/recent tracks are rebuilt. Cards and video use a durable SQLite queue processed by the monorepo background worker independently of observation. Publishing and hourly archives run on that background lane. Renderer version, basemap quality, retry state and cgroup memory diagnostics are described in [rendering reliability](../../docs/rendering-reliability.md).

Gap minutes are **estimated spacing from observed distance and typical speed**, not measured passenger waiting time. Ghosts are observed fleet deficits against the schedule, not proof that a particular trip was canceled. Cancellation records represent explicit GTFS-rt status in a trailing observation window; their expiry does not prove recovery.

## Storage and retention

SQLite uses WAL and a shared busy timeout. Positions retain at least seven days by default (`TRANSIT_POSITION_RETENTION_DAYS`), and are pruned only after a verified completed-day Parquet archive is committed. The runtime runs the archive job hourly; [the archive contract](../../docs/positions-archive.md) covers downloads, safe sample exports, recovery, and resource limits. Compact trip status and next-actionable-stop predictions retain one day. Capturing full future stop predictions requires explicit `TARC_STORE_ALL_STOP_PREDICTIONS=true` and substantially more space. Incident history, official alert versions, finalized replay, and delivery receipts persist independently. The monorepo runtime owns capacity checks, media retention, and backups.

## Verification and provenance

Run `npm test`, `npm run lint`, and the monorepo runtime health checks. `test/runtime` covers TARC delay fields, feet-based shapes, exact service exceptions, midnight service, episode lifecycle, and repeated-header protection. Inherited generic rail/streetcar modules/tests remain as upstream reference and compatibility coverage; production never schedules or fetches those modes. Legacy one-shot posting bins are optional tools, not the production collector contract.

The `docs/` files are explicitly labeled historical upstream implementation references, not TARC source claims. The original source is Cailin Pitt's `atlanta-transit-insights` (ISC declared in upstream package metadata); preserve provenance and attribution. TARC data redistribution terms are not established by public feed availability. The root project's source audit documents that evidence separately.
