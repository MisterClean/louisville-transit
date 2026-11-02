# Louisville Transit

Independent TARC service alerts, bus observations, and a growing historical archive. This monorepo combines a GTFS realtime collector and the React alerts application, adapted from Cailin Pitt's Atlanta and Chicago transit projects.

## Run locally

Install Node 24 and FFmpeg, then:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 sharp
npm run build
npm start
```

Open <http://localhost:3100>. Startup downloads TARC's official static schedule, builds its indexes, and begins collecting public vehicle positions, trip updates, and service alerts every minute. No transit API key or Bluesky account is required. The first import takes longer than subsequent observation cycles.

Configuration uses environment variables. Copy `.env.example` to `.env` and start with `node --env-file=.env scripts/server.mjs` when using a local file. `DATA_DIR` holds all mutable state; do not delete it to deploy a new release. Historical charts grow from the installation's collection start, with explicit empty and warming-up states.

## What's included

- The upstream alerts interface: active alerts, search and filters, incident timelines, route pages, calendar, daily and weekly views, statistics, route comparisons, responsive layout, and dark mode.
- Live TARC buses, route geometry, incident replay, speed and occupancy observations, predicted delays, and scheduled headways.
- Bunching, gaps, cross-route clusters, missing-bus observations, low-frequency gaps, route blackouts, explicit canceled trips, and correlated observations, with evidence and freshness gates.
- Official alerts and their lifecycle, incident and route feeds, CSV export, JSON data, and sitemap generation.
- Verified daily bus-position Parquet downloads, with immutable manifests and archive-gated SQLite retention. See [the archive contract](docs/positions-archive.md).
- Map and video rendering, local post previews, and an optional two-account Bluesky publisher. Publishing is disabled by default.
- One production process supervising sequential jobs, SQLite on persistent storage, health endpoints, bounded raw-data retention, and a backup/verification command.

TARC is a bus agency. MARTA/CTA rail, streetcar, Metra, station, and elevator-outage features are not presented as Louisville service. See [feature parity](docs/feature-parity.md) for the scope and evidence rules.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/insights` | Feed adapters, schedule matching, detectors, storage, rendering, exports, optional posting |
| `apps/alerts` | Upstream React/Tailwind frontend, archive client, feeds and public artifact generation |
| `scripts/server.mjs` | HTTP server and bounded sequential scheduler |
| `scripts/backup.mjs` | Consistent SQLite backups and checksum/integrity verification |
| `Dockerfile`, `railway.json` | One-service production deployment |

`/healthz` checks the running HTTP service. `/api/health` reports scheduler state and storage headroom. `/data/health.json` reports feed freshness and detector warm-up. They serve different purposes: a running web process does not imply fresh transit data.

## Development and operations

```sh
npm test
npm run build
npm run lint --workspace apps/insights
npm run lint --workspace apps/alerts
```

See [operations](docs/operations.md), [validation](docs/validation.md), [Bluesky setup](docs/bluesky-setup.md), [upstream comparison](docs/upstream-review.md), and the [open-source release plan](docs/open-source-plan.md).

## Attribution and licensing

This is an unofficial community project and is not affiliated with TARC. Transit data comes from [TARC's developer feeds](https://www.ridetarc.org/developers/). The application retains Cailin Pitt's upstream architecture and interface. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The repository is kept private pending upstream frontend license clarification. There is no blanket open-source license for this combined repository yet; see [LICENSE.md](LICENSE.md). Do not assume that public transit feeds or public GitHub repositories grant unrestricted redistribution rights.
