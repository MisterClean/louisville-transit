# Operations

## Runtime

Use Node 24. `npm start` serves the built frontend and schedules collection. Jobs run sequentially, with deadlines, process-group cleanup, graceful shutdown and no overlapping cycles. The scheduler starts the web server before GTFS initialization so its health and collecting state are available during a cold start.

Mount a persistent volume at `/data`. Set `DATA_DIR=/data`, `TRANSIT_DATA_DIR=/data/gtfs`, `TRANSIT_STATE_DIR=/data/state`, and `TRANSIT_WEB_DIR=/data/web`. Keep one replica because SQLite and scheduler ownership are local to this volume. Set `PUBLIC_URL` to the deployment's HTTPS origin. Do not put credentials in repository files.

The code defaults to `POLL_INTERVAL_MS=60000`; Louisville production uses `30000` to capture TARC's approximately 30-second VehiclePosition updates. The scheduler targets this interval between cycle starts and never overlaps cycles; a cycle taking longer than the interval delays the next fetch. Each cycle fetches vehicle positions, trip updates and alerts; only advanced feed timestamps create new observation snapshots. Static GTFS and schedule indexes refresh daily. Media and optional publication run at a slower cadence. Publishing defaults to `TRANSIT_PUBLISH_ENABLED=false`; enabling it requires the account setup checklist.

## Lean hosting decisions

- One service serves assets, JSON and HTTP health while supervising collector jobs.
- One persistent SQLite volume; no managed SQL service, cache server, separate worker, cron service or object-storage dependency.
- One US East replica, near Louisville; no preview environments or duplicate deployments.
- Always awake because collection needs continuity. Autosleep would create gaps in evidence.
- A 1 vCPU / 1 GB memory ceiling initially bounds runaway work. Limits are ceilings, not evidence of sustained usage; inspect measured memory during GTFS and media jobs before reducing them.
- Raw positions retain at least seven days and are pruned only after verified daily Parquet publication; compact trip status/predictions retain one day. Generated media is a bounded cache. Incident records, Parquet archives and structured replay have separate persistent lifecycles. See [archive operations](positions-archive.md).
- HTTP compression and cache headers reduce transfer. Data uses short cache lifetimes; content-addressed application assets can be cached long-term.
- Collection pauses before disk exhaustion; `/api/health` exposes available space. Archive growth still needs occasional review.

Local measurement with roughly 67 buses and 199 active trip updates showed about 47 MiB idle web-process RSS and short collector cycles. This excludes transient worker peaks and is not a production bill estimate. Production metrics and billing data are the source for future cost estimates.

## Deploying a reviewed revision

Run CI for the intended Git revision before release. The Docker build installs native modules on Linux, builds the frontend, and removes development dependencies. Keep the attached volume and environment variables when replacing the application image.

If Railway's GitHub integration has access to the repository, connect the chosen branch or pin an exact reviewed commit. Otherwise deploy from a clean checkout with the Railway CLI:

```sh
railway up --project PROJECT_ID --environment ENVIRONMENT_ID --service SERVICE_ID --detach
```

Project and service IDs are deployment configuration, not source defaults. A CLI upload does not enable automatic deployment on Git pushes. Verify the specific deployment reaches `SUCCESS`, then check fresh source timestamps and successful collection cycles; the HTTP health check alone is insufficient. Source changes need a new reviewed deployment.

## Health and failures

`/healthz` checks HTTP liveness. `/api/health` includes job success/failure, last successful cycle and storage. `/data/health.json` reports each feed's source timestamp and feature readiness. A successful HTTP response alone is insufficient to claim collection works.

If feeds fail, retain the existing archive and show stale/unavailable state. Do not clear incidents or infer missing buses from the outage. If a job fails, inspect bounded service logs and the named job before restarting. Preserve `/data` during deployments and code rollbacks.

## Backup and restore

Create a consistent backup into a new private directory:

```sh
DATA_DIR=/data node scripts/backup.mjs create /backup/new-snapshot
node scripts/backup.mjs verify /backup/new-snapshot
```

The command uses SQLite's online backup API, checksums files and verifies database integrity. The size budget is bounded. It includes state and web exports, including private account sessions when configured; protect backup access. GTFS can be rebuilt from the official source.

Restore verified `state/` and `web/` directories into an empty `DATA_DIR` with the service stopped, then restart the tested application. Preserve newer social receipts when rolling back code. Never restore an old receipt database over newer posts without reconciliation.

The application does not automatically send backups off-host. Configure provider snapshots or a private off-host destination before relying on long-term disaster recovery. An attached volume protects state across ordinary deployments; it is not an independent backup.

## Dependency status

The port updates Sharp to a patched release and loads the official GTFS schema directly with protobufjs, removing the unused protobuf compiler dependency chain. The Bluesky SDK currently retains a Zod dependency covered by GHSA-mrhx-c7xc-m3w5. The publisher is disabled by default; its SDK fetch transport bounds response bytes, nesting, node count and collection sizes before schema validation. Track upstream's compatible Zod fix before public release; do not apply an incompatible major-version override merely to hide an audit finding.

## Observation coverage and historical metrics

`observation_days` is a durable SQLite ledger independent of incident occurrence and raw-position retention. Each fresh, successful, independent VehiclePosition header can connect to the previous successful sample only when their source timestamps are at most 120 seconds apart. Longer outages contribute **no** observed time. Intervals split at `America/New_York` midnight; day duration follows DST (23, 24, or 25 hours).

A day becomes eligible for period denominators only after it has ended and at least **95%** of its actual duration is covered by these intervals. This is a declared monitoring-coverage threshold, not a guarantee of perfect service or perfect telemetry. The public archive exports `coverage.complete_days` and per-day fractions. Unknown days are hatched in timelines/calendars; period comparisons require every completed day in the requested window. Streak labels mean days without **recorded** incidents among eligible observed days. The current partial day never contributes a completed incident-free day. An old archive start alone does not establish coverage after an outage.

`data_start_ts` is the first successful complete three-feed capture, not installation time or a failed first attempt. Initial empty history and incomplete weeks/baselines show collecting/unavailable states. Existing incident records remain inspectable independently of whether a complete statistical period is available.
