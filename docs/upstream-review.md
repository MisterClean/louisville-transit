# How the Atlanta port works

Reviewed revisions are recorded in `THIRD_PARTY_NOTICES.md`.

Chicago Insights is the producer: it observes agency feeds, stores history in SQLite, detects service patterns, renders posts and media, and exports a public archive. Chicago Alerts is the consumer: a React/Tailwind app reading versioned JSON shards, aggregates, geometry and replay tracks. The projects have distinct responsibilities; both are needed for a complete installation, but do not need separate hosting services.

Cailin's Atlanta producer keeps this design while replacing CTA's proprietary bus tracker with GTFS realtime vehicle positions and trip updates. It joins realtime trip IDs to static GTFS and projects GPS observations onto the trip's shape to reconstruct distance along the route. This is the closest base for TARC. It also adds MARTA rail, streetcar and official-alert adapters that are not Louisville services.

The Atlanta frontend retains the bounded schema-v2 incident store and essentially the Chicago interface: current incidents, filters, timelines, route indexes, trends, calendars, comparisons, feeds, exports and detail pages. Its original build fetches data from a separate origin; this monorepo replaces that step with same-origin runtime exports.

## Louisville changes beyond renaming

- Public TARC static GTFS and three realtime feeds replace MARTA endpoints. No transit credentials are required.
- Static route IDs and displayed route numbers remain separate: route ID `1` is displayed as `01`. Trip IDs join the feeds to the correct shape and schedule.
- Shape distance units are inferred against geographic distance; TARC's feet must not be treated as Atlanta's kilometer-based shape distances.
- Service calendars, exception dates, trips after midnight and the `America/New_York` timezone remain part of schedule matching.
- Complete and advancing feed snapshots, entity freshness, ingestion success and contiguous observation coverage control detection and lifecycle transitions. An outage cannot become evidence that service disappeared or recovered.
- Local incident records and analytics are published whether or not Bluesky accounts exist. Upstream's social-post filters no longer hide locally observed events.
- Atlanta's train-only replay exporter has been adapted to actual bus observations and GTFS shapes.
- A single scheduler coordinates collection, detection, media, exports and optional social publishing. Static files and data are served together. No R2 sync, GitHub dispatch token, rebuild webhook, cron daemon or second application service is required.
- Generated route maps work without a provider using explicitly labeled route geometry. An optional Protomaps key adds a street basemap.

The interface preserves upstream layout and components, while rail-only controls are removed and Louisville live buses and route analytics use the same visual language. Legacy producer documentation is clearly labeled as upstream reference material; current operating instructions are in the monorepo root and `apps/insights/README.md`.
