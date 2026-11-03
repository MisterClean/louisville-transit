# Louisville Transit

**See what's happening on TARC, and how the service has changed over time.** [Open the live dashboard](https://tarctransitalerts.app) to follow official alerts, live buses, route conditions, and an archive of observed disruptions across Louisville and Southern Indiana.

This independent project combines a TARC feed collector with a public dashboard. It is adapted from Cailin Pitt's [Atlanta Transit Insights](https://github.com/cailinpitt/atlanta-transit-insights) and [Atlanta Transit Alerts](https://github.com/cailinpitt/atlanta-transit-alerts), with Chicago versions as earlier references. It is not operated or endorsed by the Transit Authority of River City (TARC).

## Explore the dashboard

- **Check current service:** see active agency alerts and observed bus disruptions, with route filters, source timestamps, and the evidence behind each observation.
- **Follow a route:** find its stops and shape, live vehicles, recent incidents, scheduled headways, and available replay or speed and occupancy views.
- **Look back:** browse incident details, day and week views, a calendar, comparisons, and statistics. History begins when this installation started collecting; unknown periods are shown as unknown.
- **Use the data:** download incident CSV and JSON feeds, or verified daily bus-position Parquet files via the [archive contract](docs/positions-archive.md). Data is generated from this installation's observations, not a complete historical TARC record.

The app distinguishes **official TARC alerts** from its own **detector observations**. A missing vehicle observation does not prove a trip was canceled; predicted lateness is not a measured arrival. Source outages do not clear incidents or count as quiet service. [Feature scope and evidence rules](docs/feature-parity.md) explain each detector.

## Run your own copy

Requires **Node.js 24**, npm, and **FFmpeg** (for video rendering). The first start downloads TARC's public GTFS schedule and begins collecting vehicle positions, trip updates, and alerts. No TARC API key, Mapbox token, or Bluesky account is needed.

```sh
git clone https://github.com/MisterClean/louisville-transit.git
cd louisville-transit
npm ci --ignore-scripts
npm rebuild better-sqlite3 sharp
npm run build
npm start
```

Open [http://localhost:3100](http://localhost:3100). The first schedule import takes longer than a normal collection cycle. Leave the process running to accumulate history. Stop it with Ctrl+C; restarting with the same data directory resumes that history. Do not run two collectors against one SQLite database.

For local configuration, copy `.env.example` to `.env` and start with `node --env-file=.env scripts/server.mjs`. `npm start` reads shell environment variables but does not load `.env` itself. The default data directory is `./state`; keep it outside disposable build folders and back it up.

| Variable | Local default | Purpose |
| --- | --- | --- |
| `PORT` | `3100` | HTTP port for the dashboard, API, and health endpoints |
| `DATA_DIR` | `./state` | Persistent root for SQLite, GTFS cache, archives, and exports |
| `POLL_INTERVAL_MS` | `60000` | Target interval between collection cycles; cycles never overlap |
| `PUBLIC_URL` | `http://localhost:3100` | Public origin for canonical links and feeds |
| `TRANSIT_PUBLISH_ENABLED` | `false` | Opt in to Bluesky posting only after [account setup](docs/bluesky-setup.md) |
| `TRANSIT_POSITION_RETENTION_DAYS` | `7` | Minimum raw SQLite position window; pruning requires verified Parquet publication |
| `TRANSIT_ARCHIVE_DAY_LIMIT` | `3` | Maximum completed days considered by each archive run |

See [`.env.example`](.env.example) for the remaining archive limits and optional Mapbox and Bluesky settings. The collector uses America/New_York service dates, including overnight GTFS times and daylight saving transitions. Public feeds do not establish a service-level guarantee or unrestricted redistribution rights.

## How it works

| Path | Role |
| --- | --- |
| [`apps/insights`](apps/insights) | TARC adapters, GTFS joins, detectors, SQLite storage, Parquet archives, optional publishing |
| [`apps/alerts`](apps/alerts) | React dashboard, incident archive, route views, maps, and public feeds |
| [`scripts/server.mjs`](scripts/server.mjs) | One HTTP process and sequential scheduler for feed and export jobs |
| [`scripts/backup.mjs`](scripts/backup.mjs) | Consistent SQLite backup and integrity verification |
| [`Dockerfile`](Dockerfile), [`railway.json`](railway.json) | Single-service container deployment |

The runtime writes mutable state under `DATA_DIR`: `gtfs/` for schedules, `state/` for SQLite and private state, and `web/` for generated public JSON, media, and Parquet. `/healthz` checks HTTP liveness; `/api/health` reports jobs and storage; `/data/health.json` reports feed freshness and detector readiness. A healthy web server alone does not prove fresh transit data.

### Railway deployment

The production app runs as **one service with one replica** and a persistent volume mounted at `/data`. Set `DATA_DIR=/data`, `TRANSIT_DATA_DIR=/data/gtfs`, `TRANSIT_STATE_DIR=/data/state`, and `TRANSIT_WEB_DIR=/data/web`; set `PUBLIC_URL` to your HTTPS origin. Keep the volume attached at the same path across deployments. SQLite, Parquet, and archive manifests live there; never replace it with a new empty volume during a code deploy. Do not enable multiple replicas against the same local SQLite state. Railway builds from the root [`Dockerfile`](Dockerfile); verify the start command and `/healthz` check in the service settings. [`railway.json`](railway.json) records the legacy config-as-code intent, which new Railway services may not apply.

For a fork, connect your own Railway project to your repository's protected `main` branch and enable **Wait for CI** before automatic production deploys. Keep deployment secrets in Railway variables. [Operations](docs/operations.md) covers health, backups, release checks, and restore; [daily archive documentation](docs/positions-archive.md) covers download and retention guarantees. A volume survives ordinary deploys but is not an off-site backup.

## Develop and contribute

```sh
npm run lint --workspace apps/insights
npm run lint --workspace apps/alerts
npm test
npm run build
```

The CI workflow runs these checks and builds the production container on pull requests and `main` pushes. Tests use fixtures and do not require live TARC or social credentials. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing detector or data contracts. Report sensitive issues through [SECURITY.md](SECURITY.md).

## Credits, data, and license status

TARC supplies the [official developer feeds](https://www.ridetarc.org/developers/). The app credits TARC for transit data and does not imply agency endorsement. Map and artwork attribution, upstream revisions, and dependency notes are in [third-party notices](THIRD_PARTY_NOTICES.md). This port retains upstream code and design; it is not a clean-room reimplementation.

The repository currently has **no blanket open-source license**. The license for Louisville-specific integration code and the scope of upstream frontend redistribution permission must be recorded before the repository is made public. See [LICENSE.md](LICENSE.md) and the [release checklist](docs/open-source-plan.md). Public access to a feed or repository alone does not grant rights to republish its contents.
