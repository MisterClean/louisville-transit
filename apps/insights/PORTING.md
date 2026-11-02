# Porting `cta-insights` → `louisville-transit-insights`

This repo is a fork-first port of [`cta-insights`](https://github.com/cailinpitt/cta-insights)
to TARC / Louisville.

## Status: CTA tree removed

**The legacy CTA/Metra tree has been deleted.** All live code is under
`src/tarc/`, `bin/tarc/`, `scripts/tarc/`, and `test/tarc/`. The only
non-TARC code that remains is:

- **`src/shared/`** — trimmed to the 11 agency-agnostic modules TARC actually
  reuses: `cleanup, env, geo, ghostFormat, observationDescribe, polyline, post,
  projection, retry, videoTracks, webPushTrigger`. Everything else (the CTA
  alerts adapter, the `history`/`observations`/`gtfs`/`state` SQLite layer, the
  CTA `recap`/`relatedQuotes`/`directionLabel`/etc.) was deleted — TARC has its
  own equivalents under `src/tarc/`.
- **`bin/export-csv.js`** — agency-agnostic CSV generator, still called by
  `bin/tarc/push-web-data.sh`.
- **`scripts/configure-healthchecks.js`, `scripts/install-logrotate.sh`,
  `cron/logrotate.conf`, `cron/healthchecks.env.example`** — ops tooling pending
  a slug/path rebrand for TARC.

## The governing rule (still in force)

> Keep CTA-derived code **only while it is serving as a reference** for the TARC
> version you are writing. Once the TARC analog exists — or you've decided there is
> no analog — **delete it in the same change**. Nothing stays in the tree marked
> "might be useful."

The **TARC crontab (`cron/tarc-crontab.txt`) is the reachability root.** If a `bin/`
script is not in the TARC schedule and nothing imports it, it is dead. See the knip
workflow at the bottom for the mechanical check.

> **The per-module tables below are historical** — they recorded the original
> CTA→TARC disposition during the port. The PORT/KEEP rows are done; the
> DELETE/REFERENCE→DELETE rows have been carried out. Kept for provenance.

## TARC vs CTA, in one paragraph

TARC runs **rail** (Red, Gold, Blue, Green — 4 lines), **bus**, and the **Louisville
Streetcar**. There is **no commuter-rail analog to Metra**, so the entire `metra/` surface
is destined for deletion — *except* that two pieces of it are the best reference we have:
`metra/api.js` decodes GTFS-realtime protobuf exactly the way TARC bus will, and the
Metra cancellation/delay/schedule code is timetable-anchored, which is the closest model
to TARC **rail** if train identity turns out to be stable (rail Path A in `plan.md`).
TARC **bus** is the strongest parity (GTFS-rt vehicle positions + trip updates). TARC
**rail** is the risk area: it's a station-arrival REST feed, not vehicle positions, so the
CTA Train Tracker adapter does not transfer directly.

## Status legend

- **PORT** — logic is reusable; swap the CTA adapter/metadata for TARC.
- **KEEP** — generic infra; rebrand strings/config but no structural change.
- **DELETE** — CTA/Metra-only, no TARC analog. Remove once any reference value is spent.
- **REFERENCE→DELETE** — keep temporarily as the template for a TARC module, then delete.

---

## `src/shared/` — mostly KEEP (generic infra)

| Module(s) | Status | Notes |
|---|---|---|
| `history.js`, `observations.js` | PORT | Keep SQLite model; extend observation schema for rail arrival snapshots. Preserve `alerts.json` schema v2 contract. |
| `state.js`, `bluesky.js`, `post.js`, `postDetection.js`, `retry.js`, `runBin.js`, `format.js`, `geo.js`, `polyline.js`, `projection.js`, `stats.js`, `gtfs.js` | KEEP | Generic; rebrand only. TARC-specific equivalents now exist for the first posting slice under `src/tarc/shared/{bluesky,format,incidents,postDetection,runBin,state}.js`; keep CTA shared files only while CTA entrypoints remain as references. |
| `recap.js`, `recapPost.js`, `videoTracks.js`, `eventLink.js`, `eventTracks.js`, `disruption.js`, `directionLabel.js`, `ghostFormat.js`, `ghostsLog.js`, `observationDescribe.js`, `relatedQuotes.js`, `alertPost.js`, `cleanup.js`, `webPushTrigger.js` | KEEP/PORT | Rebrand; `observationDescribe.js` has a `TRAIN_LINES` table to replace. `eventTracks.js` ported to `src/shared/eventTracks.js` (event-replay "Watch it unfold" tracks, rail-only; see docs/REPLAY.md). |
| `ctaAlerts.js` | DELETE | CTA Train/Bus Tracker alerts API + Chicago parsing. Replaced by the TARC official-alert adapter (Phase 6). |
| `trainSegment.js` | PORT | CTA rail segment helper → TARC rail (rail-path dependent). |

## `src/bus/` — PORT (closest parity)

The big swap is `api.js`: CTA Bus Tracker exposes `pid`/`pdist` (pattern + distance along
pattern); TARC is GTFS-rt and you join by `trip_id` and map-match to GTFS `shapes`. Every
detector that reasons over `pdist`/`pid` needs a shape-progress adaptation.

| Module(s) | Status | Notes |
|---|---|---|
| `api.js` | PORT | CTA Bus Tracker → TARC GTFS-rt VehiclePositions/TripUpdates. Use `metra/api.js` as the protobuf-decode reference. |
| `bunching.js`, `gaps.js`, `ghosts.js`, `pulse.js`, `thinGaps.js`, `speedmap.js`, `motion.js`, `heldClusters.js` | PORT | Detector logic reusable; rework `pid`/`pdist` → shape progress. |
| `patterns.js`, `routes.js`, `stops.js` | PORT | CTA pattern model → TARC GTFS trips/shapes/stops. |
| `bunchingPost.js`, `gapPost.js`, `bunchingVideo.js`, `gapVideo.js`, `bluesky.js` | PORT | Bus bunching, gap, ghost, and speedmap posting are ported under `src/tarc/bus/{bunchingPost,gapPost,ghostPost,speedmapPost}.js`, `src/tarc/map/{busBunching,busGap,busSpeedmap}.js`, and `bin/tarc/bus/{bunching,gaps,ghosts,speedmap}.js`. Remaining bus video/update/close flows still need ports. |
| `trafficSignals.js` | DELETE | Chicago OpenStreetMap traffic-signal annotation for timelapse. Re-add for Louisville only if wanted. |
| `fleet.js` | DELETE | CTA bus fleet/vehicle metadata. |

## `src/train/` — PORT, gated on rail feasibility (Phase 5)

CTA Train Tracker (`ttpositions`) gives true vehicle positions. TARC rail is a
station-arrival REST feed. Do **not** port these until the rail path (A/B/C in `plan.md`)
is decided — the data model underneath them changes.

| Module(s) | Status | Notes |
|---|---|---|
| `api.js` | DELETE | CTA Train Tracker → replaced by TARC rail REST adapter. The rail parity gate. |
| `bunching.js`, `gaps.js`, `ghosts.js`, `pulse.js`, `speedmap.js`, `motion.js`, `heldClusters.js` | PORT (rail-path dependent) | Concepts reusable; CTA versions assume vehicle positions + L geometry. |
| `findStation.js` | PORT | Station matching → TARC rail stations. |
| `snapshot.js`, `snapshotVideo.js` | PORT/DELETE | System timelapse; depends on positions. |
| `bunchingPost.js`, `gapPost.js`, `bunchingVideo.js`, `gapVideo.js`, `bluesky.js` | PORT | Rebrand. |
| Loop-trunk / Purple Express logic (embedded in `pulse.js`, `speedmap.js`) | DELETE | CTA-only geometry quirks (Loop direction flip, express overlay). No TARC analog. |

## `src/metra/` — DELETE (no commuter-rail analog) — but mine two for reference first

| Module(s) | Status | Notes |
|---|---|---|
| `api.js` | REFERENCE→DELETE | GTFS-rt protobuf decode (positions/tripupdates/alerts). Best template for TARC **bus** `api.js`. Delete once that exists. |
| `cancellations.js`, `delays.js`, `schedule.js` | REFERENCE→DELETE | Timetable-anchored, `trip_id`-joined detection. Template for TARC **rail** Path A. Delete once rail path is settled. |
| `metraAlerts.js`, `cancellationAlert.js`, `delayAlert.js`, `lines.js`, `metraStations.js`, `recap.js`, `speedmap.js`, `bluesky.js`, `data/` | DELETE | Metra-specific metadata/posting/rendering. |

## `src/map/` — KEEP infra, PORT geography

| Module(s) | Status | Notes |
|---|---|---|
| `common.js`, `index.js` | KEEP | Generic Mapbox render infra. |
| `heatmap.js` | PORT | `CHICAGO_BBOX` / `LOOP_BBOX` → Louisville bbox. |
| `disruption.js`, `gapChart.js` | KEEP/PORT | Rebrand. |
| `bus/`, `train/` | PORT | Rail subdir gated on rail path. |
| `metra/` | DELETE | — |

## `bin/` — entrypoints (the crontab roots)

| Entry | Status | Notes |
|---|---|---|
| `bus/*.js` | PORT | Bus detector cores and posting entrypoints are ported under `src/tarc/bus/` and `bin/tarc/bus/`: bunching, gaps, ghosts, and speedmap. Remaining TARC bus video/update/close bins still need ports. |
| `train/*.js` | PORT (rail gate) | Hold until rail path decided. |
| `metra/*.js` | DELETE | After `src/metra` reference value is spent. |
| `export-web.js`, `export-daily.js`, `export-csv.js`, `export-event-tracks.js` | PORT | Keep schema v2 + server-side pairing; strip Metra, add TARC agency/mode. `export-event-tracks.js` ported to `bin/tarc/export-event-tracks.js` (rail-only, reads `rail_observations`; cron `19-59/15`; see docs/REPLAY.md). |
| `incident-roundup.js`, `audit-alerts.js` | PORT | Multi-signal rollup + audit. |
| `cron-run.sh`, `push-web-data.sh` | KEEP | Rebrand R2 bucket, dispatch repo, healthchecks slugs. |
| `backfill-*.js`, `cleanup-metra-resolved-cancellation-replies.js` | DELETE | One-off CTA/Metra data migrations; not reusable. |

## `scripts/`

| Script | Status | Notes |
|---|---|---|
| `fetch-gtfs.js` | PORT | CTA GTFS → TARC `google_transit.zip`. |
| `observeBuses.js`, `observeTrains.js` | PORT | Rail observer gated on rail path. |
| `compute-low-frequency-routes.js` | PORT | Recompute for TARC routes. |
| `backup-db.sh`, `restore-db.sh`, `install-logrotate.sh`, `configure-healthchecks.js` | KEEP | Rebrand. |
| Debug/replay (`demo*.js`, `render-*.js`, `replay-*.js`) | KEEP/PORT | Useful tooling; rebrand as touched. |
| `fetch-metra-gtfs.js` | REFERENCE→DELETE | `trip_id` join reference, then delete. |
| `fetch-signals.js`, `fetch-train-lines.js`, `observeMetra.js`, `capture-metra-cancellation.js` | DELETE | Chicago signals / CTA line geometry / Metra-only. |
| `delete-*-fp.js` (3) | DELETE | CTA incident-specific FP cleanups. |
| `export-*-fixtures.js` | PORT/DELETE | FP-fixture exporters; pattern reusable, CTA data not. |

---

## Port progress

Live TARC code is being staged under `src/tarc/` and `scripts/tarc/` so the
CTA tree keeps working as a reference until each analog is proven. Done so far
(plan Phase 2, bus half):

- `src/tarc/bus/api.js` — GTFS-rt VehiclePositions/TripUpdates decode+normalize.
  **This is the analog of `src/metra/api.js`** (the protobuf reference). Once the
  bus *detector* port consumes it, delete `src/metra/api.js` per the rule above.
- `src/tarc/gtfs.js` — static GTFS load + the realtime→static `trip_id` join and
  route-number normalization. First slice of the larger `src/shared/gtfs.js` port.
- `scripts/tarc/{fetch-static-gtfs,capture-bus-vp,capture-bus-tu,build-bus-fixtures}.js`
  — fixture tooling; raw captures land in gitignored `data/tarc/`.
- `src/tarc/rail/api.js` — rail `traindata` REST decode+normalize. **Rail
  feasibility gate (Phase 5) is resolved: PATH A with true positions** — stable
  `TRAIN_ID` + real lat/lon that move snapshot-to-snapshot. Rail can target
  near-full CTA parity, not the fallback headway map. This means the CTA Train
  Tracker reference (`src/train/api.js`, Train Tracker `ttpositions`) is the
  wrong data model — the TARC rail adapter is REST station-arrival + position,
  so port the train *detectors* against `src/tarc/rail/api.js`'s shape.
- `scripts/tarc/{capture-rail,build-rail-fixtures}.js` — rail fixture tooling.
- `src/tarc/alert/api.js` — official alerts. **Discovery: TARC alerts are
  GTFS-rt ServiceAlerts** (`…/alert/alerts.pb`), not a scraper — so `ctaAlerts.js`
  (the XML CTA Tracker alerts adapter) has **no analog to port**, it's a straight
  DELETE; the TARC replacement is this GTFS-rt parser (mirrors Metra's). Live
  feed was empty at discovery, so the fixture is synthetic + a real empty capture
  until a genuine alert is caught.
- `src/tarc/alert/significance.js` — significance gate + mode classification +
  post text (Phase 6). **Analog of `src/metra/metraAlerts.js`** (also a native
  GTFS-rt feed). Keyword admit/veto with a strong-effect admit; tags each alert
  `bus|rail|streetcar|general`.
- `src/tarc/alert/store.js` — official-alert lifecycle storage (`alert_posts` +
  `alert_versions`) on the shared TARC DB. **Analog of the `alert_posts`/
  `alert_versions` subset of CTA `src/shared/history.js`**, trimmed of the
  Metra single-train cancellation/delay machinery; adds a `mode` column.
- `bin/tarc/alerts.js` — republish bin (posts to `tarcalertinsights`).
  **Analog of `bin/metra/alerts.js`**, streamlined: text-only posts + text-only
  resolution replies (archive-page link cards wait for Phase 8). io-injected.
  Rail single-departure cancellations are closed silently (no resolution reply).
- `src/tarc/alert/cancellation.js` — pure rail single-departure cancellation
  classifier. **Analog of `src/metra/cancellationAlert.js`**, but parses TARC's
  alert prose (clock time + origin) instead of resolving a GTFS timetable.
  Consumed by `bin/tarc/alerts.js` (terminal/silent-close) and
  `bin/tarc/export-web.js` (incident `status` block + merge exclusion). Frontend
  display analog: `louisville-transit-alerts/src/lib/cancellation.js`.
- `scripts/tarc/{capture-alerts,build-alert-fixtures}.js` — alert fixture tooling.
- `test/tarc/` + `test/tarc/fixtures/` — decode + join validation against real
  captured feeds (bus + rail + alerts). See `docs/TARC_FEEDS.md` for the
  validated feed reality and the Path A evidence.

- `src/tarc/storage.js` — SQLite observation history (Phase 3): `bus_observations`,
  `bus_trip_updates`, `rail_observations`, `rail_arrivals`. **Analog of the CTA
  `src/shared/observations.js` + the `observations`/`metra_trip_updates` tables in
  `src/shared/history.js`** — TARC bus is GTFS-rt (trip_id + speed, no pdist/pid)
  and rail carries positions AND station predictions, so the CTA `observations`
  schema doesn't fit; this is a fresh TARC-shaped DB. The bus/rail fetchers now
  record into it by default (`{record:false}` to opt out). Once detectors read
  from it, the CTA `observations.js` + its tables become DELETE candidates.
- `test/tarc/storage.test.js` — round-trips fixtures through the adapters into
  storage and back, plus rolloff.

- `src/tarc/bus/shapes.js` — the **`pdist` analog**: loads GTFS `shapes.txt`
  (cumulative feet from `shape_dist_traveled`) and projects a vehicle's lat/lon
  onto its trip's shape → distance-along-shape. The mapping the detectors run on
  is `CTA pid ↔ TARC shape_id`, `CTA pdist ↔ projected distFt`. This is the core
  rework that replaces CTA Bus Tracker's direct `pid`/`pdist`.
- `src/tarc/bus/speedmap.js` — first bus detector ported (Phase 4). Uses TARC's
  reported `speed` (m/s, ~57% of vehicles) placed on the route via shapes.js, so
  a speedmap works from a single snapshot (CTA had to derive speed from pdist
  deltas). Binning/summary/colour logic carried over from `src/bus/speedmap.js`.
  Pure core (samples → bins → summary); the live collection loop + posting/render
  layer are not ported yet.

- `src/tarc/bus/schedule.js` + `scripts/tarc/build-schedule-index.js` — the
  **scheduled-headway index**, analog of CTA's `data/gtfs/index.json` (built by
  `scripts/fetch-gtfs.js`). Streams `stop_times.txt`, computes median scheduled
  headway / trip duration per shape and active-trip count per route+direction,
  keyed by (shape|route, dayType, hour). Headways are measured PER SHAPE (a
  direction's shapes mashed together give bogus ~0-min gaps when a through trip
  and a branch leave together); the route rollup is the median of shape headways.
  Output `data/tarc/schedule-index.json` (gitignored, built by cron). This
  unblocks gaps + ghosts.

- `src/tarc/bus/gaps.js` — bus gap detection ported. `detectBusGaps` is the CTA
  algorithm (generic over `{shapeId, distFt}`); `gapsFromObservations` wires it to
  TARC sources — projects positions onto shapes, reads expected headway from the
  schedule index (with route-direction fallback). Reuses CTA thresholds +
  `shared/geo.terminalZoneFt`. Pure core; posting layer not ported.

- `src/tarc/bus/bunching.js` — bus bunching detection ported. Purely spatial
  (no schedule index): clusters buses within 800 ft of along-shape distance, with
  the geo-consistency + terminal guards from CTA. `bunchesFromObservations`
  projects positions and detects; `findParkedBusVids`/`assignBusNumbers` carried
  over. Posting layer not ported.

- `src/tarc/bus/ghosts.js` — bus ghost detection ported. Compares observed
  distinct vehicles/snapshot (grouped by canonical `direction_id`) against the
  schedule index's `activeByHour`; CTA threshold/ramp/tail gates carried over.
  Simpler than CTA — trip_id gives direction directly, so no async pid→pattern
  resolution. `ghostsFromObservations` is the bridge. Posting layer not ported.

- `scripts/tarc/observe-{buses,rail,bus-tripupdates}.js` + `src/tarc/observeUtil.js`
  — the live capture loop (analog of CTA `scripts/observeBuses.js`/`observeTrains.js`).
  Poll the feeds, record via the adapters' default record path, rolloff the 7-day
  trip-update/arrival window. `runTicks` densifies within a cron firing. **Bus positions and
  TripUpdates are split into separate jobs on purpose:** positions are ~160
  rows/fetch and feed every detector, so they run at 30s density (2 ticks/min);
  TripUpdates are ~14k rows/fetch (one row per trip×upcoming-stop) and no detector
  reads them yet, so they run every 5 min. Rail runs 2 ticks/30s for
  position-delta speed. Verified end-to-end against live feeds. Cron block:
  `cron/tarc-crontab.txt`, installed safely (marker-merge, never clobbers other
  jobs) via `scripts/tarc/install-crontab.sh`. npm: `tarc:observe-*`.

### Rail detection (Phase 5) — feature-complete, Path A

- `src/tarc/rail/lines.js` — rail `pdist` analog: one representative geometry per
  line (longest GTFS shape; both directions share track), `projectTrain` reuses
  `bus/shapes.projectToShape`. Validated live: median ~17 ft offset.
- `src/tarc/rail/trains.js` — `latestTrainPositions` (freshest fix per train,
  projected), the gaps/bunching substrate.
- `src/tarc/rail/speedmap.js` — **speed reconstructed from position deltas**
  (rail has no reported speed), grouped by line+direction, 5-bucket train bands.
  Validated on real server data (RED/S ~35 mph, BLUE/W ~27 mph).
- `src/tarc/rail/{gaps,bunching,ghosts}.js` — spacing-vs-headway, spatial
  clustering, and observed-vs-scheduled head-count (ghosts reuses the bus engine).
  These use **line-level** schedule aggregates (`schedule.headwayForLine` /
  `activeForLine`) to sidestep the feed's N/S/E/W ↔ GTFS direction_id mismatch.

### Posting / incident lifecycle (Phase 7) — started

- `bin/tarc/bus/bunching.js` — first TARC detect→render→post entrypoint. It
  reads the latest observed bus snapshot from `state/tarc.sqlite` (no extra
  feed fetch), filters parked/terminal/cooldown/capped candidates, renders a map,
  and posts through the TARC insights Bluesky account. Supports `--dry-run` and
  `--check`.
- `bin/tarc/bus/gaps.js` — second TARC detect→render→post entrypoint. It
  reads the latest observed bus snapshot, detects oversized route gaps from the
  schedule index, filters cooldown/cap candidates, renders a gap map, and posts
  through the same TARC insights account. Supports `--dry-run` and `--check`.
- `bin/tarc/bus/ghosts.js` — ghost bus rollup entrypoint. It uses a 60-minute
  observation window, compares observed service against scheduled active trips,
  records route-level ghost events/meta-signals, and posts a Bluesky text thread.
- `bin/tarc/bus/speedmap.js` — route-rotating speedmap entrypoint. It uses the
  last hour of stored reported bus speeds, skips sparse coverage, renders a
  colored route speedmap, records speedmap history, and posts an image.
- `bin/tarc/rail/gaps.js` — rail gap detect→render→post entrypoint. It reads
  the latest rail observations from `state/tarc.sqlite`, detects line/direction
  gaps from true train positions and line-level scheduled headways, filters
  cooldown/cap candidates, renders a rail line map, and posts through the rail
  insights account.
- `bin/tarc/rail/bunching.js` — rail bunching detect→render→post entrypoint.
  It clusters latest trains by line/direction, applies rail-specific severity
  semantics (tighter span is worse when train count ties), renders a line map,
  and posts through the rail insights account.
- `src/tarc/bus/bunchingPost.js` — post text + alt text for bus bunching.
- `src/tarc/bus/gapPost.js` — post text + alt text for bus gaps.
- `src/tarc/bus/{ghostPost,speedmapPost}.js` — post text helpers for ghost
  rollups and speedmaps.
- `src/tarc/rail/post.js` — post text + alt text helpers for rail gaps and
  rail bunching. Rail gaps name the flanking stations ("between X and Y") and the
  midpoint "middle of the gap" timelapse, at parity with bus gaps and CTA.
- `src/tarc/bus/stops.js` — stop lookup helpers used by bus bunching maps/posts.
- `src/tarc/rail/stations.js` — rail station-along-line projection + gap flank/
  midpoint context + the rider-facing station-name formatter (`displayStationName`,
  consolidated from railIncidents.js + disruptionPost.js).
- `src/tarc/map/{common,busBunching,busGap,busSpeedmap}.js` — Sharp-backed
  static map renderers for bus bunching, bus gap, and speedmap images.
- `src/tarc/map/railIncidents.js` — Sharp-backed rail incident map renderer for
  rail gaps and bunching.
- `src/tarc/shared/{bluesky,format,incidents,postDetection,runBin,state}.js` —
  first TARC shared posting/runtime layer: Bluesky login/post helpers,
  cooldown/state storage, bunching + gap + ghost + speedmap event history,
  cap/callout/record logic, meta-signal recording, and bin setup/check/dry-run
  utilities.
- `cron/tarc-crontab.txt` — now schedules all bus post jobs plus rail gap and
  rail bunching jobs.
- `test/tarc/{bunchingPost,gapPost,busFinalPost,railPost}.test.js` — post text,
  alt text, cooldown/cap/callout/history, and import-smoke coverage for the
  posting bins.

### Low-frequency / blackout detectors + CTA alignment (2026-06-16)

Ported the two detectors CTA built to cover the high-frequency detectors' blind
spots — both biased TARC toward false negatives until now (see the suppression
audit).

- `src/tarc/bus/thinGaps.js` + `bin/tarc/bus/thin-gaps.js` — `thinGaps.js` is a
  verbatim port of CTA's pure core. The bin wires it to the TARC schedule index
  (`headwayForLine`/`activeForLine`) and storage; eligible = bus routes with
  current headway ≥20 min (the set the mainline gap/ghost detectors can't fire on).
  Fires when no bus is observed in `max(2× headway, 60 min)`; one post/route/day
  via a 24h cooldown; threads a "buses observed again" clear reply.
- `src/tarc/bus/pulse.js` + `bin/tarc/bus/pulse.js` — `pulse.js` is a verbatim
  port of CTA's `detectBusBlackouts` (blackout path; CTA's `heldClusters` sub-
  detector is **deferred**). The bin owns the complementary higher-frequency set
  (headway <20 min): fires when a route expecting ≥2 active buses shows zero
  vehicles while the fleet reports normally, with the feed-stale / pipeline-quiet
  / cold-start / ramp / wind-down guards intact. 2h re-post cooldown + clear reply.
- `src/tarc/shared/incidents.js` — added the `disruption_events` table +
  `recordDisruption` / `findUnresolvedDisruptions` (CTA `disruption_events` analog).
  `bin/tarc/export-web.js` surfaces posted `observed-thin` (→ `thin-gap`) and
  `observed` (→ `pulse-cold`) firings as **standalone** `['bot']` incidents, each
  paired with the next `observed-clear` — the deliberate exception to "lone single
  detectors don't make a website event," since a silent route has no signal to
  fold into a roundup.
- `src/tarc/storage.js` — added `getLastBusObservationTs`,
  `countDistinctBusObservationTs`, `getDistinctBusRoutesSince`.
- **Gap cooldown aligned with CTA**: `incidents.gapCooldownAllows` now uses the
  decaying-margin (1.25×→1.1× over the hour) + sustained-severity escape
  (≥20 min & ≥3.0×) override instead of the flat 1.25×, so sustained/aged gap
  escalations re-post the way CTA's do.
- Tests: `test/tarc/{thinGaps,pulse,gapCooldownAllows}.test.js`. Cron:
  `bus-thin-gaps` (15 min) + `bus-pulse` (5 min) added to `cron/tarc-crontab.txt`.
  Still deferred: `heldClusters`, rail pulse/thin-gaps.

**Bus detection (Phase 4) is feature-complete: speedmap, gaps, bunching, ghosts**,
all on the shapes.js `pdist` analog + the schedule index, and the live observe
loop now feeds `state/tarc.sqlite`. **Rail detection (Phase 5) is feature-complete**
under `src/tarc/rail/`. Bus posting parity is complete for speedmaps, gaps,
bunching, and ghosts. Rail posting has started with gaps and bunching.
**Official-alert ingestion + republish (Phase 6) is built**: significance gate,
`alert_posts`/`alert_versions` lifecycle store, and the `bin/tarc/alerts.js`
republish bin (post → refresh → feed-drop resolution). Still pending: pairing
official alerts with bot detections into `alerts.json` (Phase 6 export), the
website fork + data origin (Phase 8/9 — also what unblocks resolution-reply link
cards), and bus/rail video/update/close lifecycle refinements.

### Bus pulse posting parity (2026-06-22)

Brought `bin/tarc/bus/pulse.js` to full CTA `bin/bus/pulse.js` parity (it had
been posting a text-only rollup to the bus insights account):

- Posts to **`@tarcalertinsights`** (was `loginBus`) — a route blackout is a
  service disruption, not an insight, matching CTA + TARC rail pulse.
- **One post per blacked-out route** (was a batched rollup thread), each with a
  **dimmed-route blackout map** — new `src/tarc/map/busDisruption.js#renderBusDisruptionMap`,
  the bus analog of `renderRailDisruptionMap`: whole route solid-but-dimmed,
  both terminals labeled from GTFS headsigns.
- **Threads under any open official TARC bus alert** for the route via
  `alert/store.js#findUnresolvedAlertForRoundup`; clear reply threads under the
  alert too and carries a **resolved-event link card**.

Still deferred: `heldClusters` sub-detector.

## knip: the mechanical backstop

[`knip`](https://knip.dev) finds unused files and dependencies starting from the real
entrypoints (`bin/`, `scripts/`, `test/`), configured in `knip.json`.

```bash
npm install        # required for an authoritative run (loads knip's biome/husky plugins)
npm run knip       # focused: unused files + dependencies
npx knip           # full report, incl. unused exports (noisier)
```

**What to watch:** the **"Unused files"** section. It is empty today because every `src/`
module is still reachable through a CTA `bin/` entrypoint. As you delete CTA entrypoints
and trim the TARC crontab, orphaned modules will appear there — those are concrete
deletion candidates. Reconcile them against the **DELETE** rows above and remove them.

**Known noise (ignore):**
- Running `npm run knip` *before* `npm install` reports `@biomejs/biome`, `husky`, and
  `lint-staged` as unused devDependencies — a false positive because knip's plugins for
  those aren't loaded without `node_modules`. Install first.
- `ffmpeg` / `rclone` are spawned from shell scripts knip can't parse; they're listed in
  `ignoreBinaries` in `knip.json` on purpose.

**Suggested CI gate (later):** once the port settles, add `npm run knip` to CI so unused
files fail the build and dead code can't reaccumulate.
