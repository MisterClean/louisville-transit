# Contributing

Thanks for helping improve Louisville Transit. This is an independent TARC project; reports about the app belong here, while immediate service questions belong with TARC.

## Before opening a change

Search existing issues and explain the rider or operator problem. For detector changes, include the relevant source timestamp, route ID and public label, GTFS service date, and the evidence that supports the claim. Remove vehicle IDs or personal information from attachments unless essential and already public. Never commit downloaded feeds, SQLite databases, Parquet archives, `.env` files, credentials, or production backups.

Use Node 24 and the root workspace lockfile. After `npm ci --ignore-scripts` and `npm rebuild better-sqlite3 sharp`, run:

```sh
npm run lint --workspace apps/insights
npm run lint --workspace apps/alerts
npm test
npm run build
```

FFmpeg is needed for media rendering and local operation. Tests use fixtures; keep tests independent of live TARC feeds and social accounts. Add or adjust tests for changes to feed parsing, service-day handling, detector evidence gates, incident lifecycles, archive schemas, or retention. Explain any skipped checks in the pull request.

## Data and compatibility

- Keep GTFS `route_id` values as strings and preserve public labels such as `01`.
- Use America/New_York for service-day calculations, including times after 24:00 and daylight saving changes.
- Treat stale or failed feeds as unknown. Absence-based incidents require fresh, independent, contiguous observations; a transport failure must not resolve an incident.
- Keep detector state separate from Bluesky delivery state. Publishing stays opt-in, and tests must use fake adapters.
- Document changes to public JSON, CSV, or Parquet schemas and their compatibility in the pull request and relevant docs.

Small pull requests with a clear before/after example are easiest to review. New agency features need source evidence and attribution. [Feature scope](docs/feature-parity.md), [operations](docs/operations.md), and [archive contract](docs/positions-archive.md) provide the current behavior.

## Security

Please do not publish credentials, private logs, or exploitable details in a public issue. Follow [SECURITY.md](SECURITY.md) for a private report.
