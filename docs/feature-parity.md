# Feature scope and evidence

The port retains applicable bus features from the Atlanta/Chicago projects. Data begins at the installation's first successful observation; no Chicago or Atlanta history is relabeled as Louisville history.

| Feature | Louisville implementation and qualification |
| --- | --- |
| Official alerts | TARC FULL_DATASET feed; header-only alerts supported; advancing complete snapshots required for disappearance lifecycle |
| Bunching / gaps | Same-pattern GTFS projection; motion/terminal filtering; scheduled headways; gap minutes are an estimate from spacing, not measured passenger wait |
| Cross-route clusters | Nearby moving vehicles across routes, with terminal/layover exclusions |
| Missing buses / ghosts | Scheduled active service versus independent observations, with cold-start and outage gates; missing observation is not proof a trip was canceled |
| Low-frequency gaps / route blackouts | Scheduled service and fleet coverage gates, with contiguous history warm-up |
| Cancellations | Explicit GTFS TripUpdate CANCELED status; a rolling observation window does not claim that cancellation recovered |
| Correlated observations | Multiple concurrent route-level detector signals form a related incident |
| Speedmaps | Reported speeds projected onto GTFS shape bins; unknown coverage remains unknown |
| Crowding maps / rollups | Explicit occupancy fields only; omitted occupancy does not mean empty |
| Adherence | TARC stop prediction delays; labeled predictions rather than realized arrivals |
| Live bus and route maps | Real feed coordinates and official GTFS shapes, with freshness labels |
| Incident replay | Captured bus tracks, shape geometry, scrubbing/playback; only available when observations exist |
| Maps and encoded clips | Upstream bus renderers, bounded background jobs, optional Protomaps street basemap; no-key or provider-failure geometry rendering is labeled |
| Archive and analytics UI | Active events, search, filters, route/system pages, event details, daily/weekly views, calendar, statistics, comparisons, dark mode, responsive layout |
| Public exports | Same-origin schema-v2 JSON shards and aggregates, per-route/global feeds, CSV, sitemap |
| Bluesky | Two optional accounts, local previews, durable post identity and receipts, same-account threaded replies; disabled until configured |
| Rail / streetcar / Metra | Not applicable: TARC provides bus service; their UI and scheduled jobs are excluded |
| Rail station / elevator outages | Not asserted from TARC feeds; unsupported agency facilities are excluded |

Warm-up readiness and data freshness are exposed in `/data/health.json`. Detector thresholds remain conservative where sparse TARC service provides insufficient evidence. A successful empty archive means no archived incidents under these rules, not proof that every trip ran on time.

The feed contract has no documented uptime guarantee. Historical statistics describe this collector's observations and availability, not a complete reconstruction of service before collection began.

Observation coverage qualification: historical zero counts, incident-free days, streaks, 30-day disruption denominators, week comparisons, and annual comparisons are gated by a durable source-time coverage ledger. Eligible completed New York days have at least 95% coverage from independent successful snapshots no more than 120 seconds apart; DST day lengths are honored. Unknown days and outages are not silently treated as quiet days. Streaks are explicitly days without recorded incidents, not a claim that no service problem occurred.
