# Daily TARC position archives

The hourly archive job publishes completed **America/New_York calendar days** of collected bus positions as Parquet. It replaces the inherited NDJSON exporter and runs in the same sequential scheduler as the collector. No R2 bucket, additional service, DuckDB CLI, or credentials are needed. Live JSON feeds and the website's incident JSON exports keep their existing formats.

This adapts [Chicago issue #5](https://github.com/cailinpitt/chicago-transit-insights/issues/5) and [PR #6](https://github.com/cailinpitt/chicago-transit-insights/pull/6), reviewed at `5e445650e4fecaa71ccf9b7fd0da414091e25566`. Louisville uses a local persistent volume and HTTP publication instead of Chicago's remote object store. Existing Louisville production had no published NDJSON archive to migrate. A separately imported legacy manifest is rejected; it must be converted and verified explicitly before adoption.

## Download contract

Fetch `/data/positions/index.json` on the installation's public origin. It is a mutable pointer containing `manifest_version: 2`, the immutable manifest `path`, `sha256`, and byte length. Resolve paths against the origin's `/data/` directory. Verify the manifest checksum, then select a day from its `days` array.

```text
/data/positions/index.json
/data/positions/manifests/<sha256>.json
/data/positions/bus/YYYY/MM/YYYY-MM-DD.<sha256>.parquet
```

The manifest describes schema version 1, fields and units, New York day boundaries, sort order, coverage dates, and each file's checksum, row count, time extrema, quality counts, and writer settings. `route` is the stored public route label, such as `01`, rather than the canonical GTFS route ID. Identifiers and service dates remain strings. `ts` is the VehiclePosition feed snapshot time in epoch **milliseconds**; `vehicle_ts` is the individual vehicle's timestamp in epoch **seconds**. Coordinates, bearing, and speed are DOUBLE values; missing values remain null. No point geometry is duplicated in the file.

Parquet uses `route, vehicle_id, ts` ordering, ZSTD level 3, and a target row-group size of 122,880. The pinned `@duckdb/node-api@2.0.0-r.1` package supplies DuckDB 2.0.0. The manifest's nullable field contract is stable; a file with no nulls may encode a column as required.

Downloads support GET, HEAD, single byte ranges, conditional ETags, and public CORS. Parquet is streamed with `application/vnd.apache.parquet` and no HTTP gzip layer. Checksum-addressed files/manifests receive immutable caching; the latest pointer requires revalidation. Temporary databases, locks, and partial files are never exposed through archive URLs.

For a downloaded file, compatible readers can select columns or filter routes directly:

```sql
SELECT ts, vehicle_id, lat, lon
FROM read_parquet('downloaded.parquet')
WHERE route = '01'
ORDER BY vehicle_id, ts;
```

## Integrity and retention

The writer streams SQLite rows into a typed disk-backed DuckDB table. Before publication, it compares every field and duplicate using symmetric `EXCEPT ALL`, verifies the physical column types and embedded schema metadata, and hashes the file. Publication verifies the bytes again, writes an immutable manifest, then atomically replaces the latest pointer on the same volume. Unchanged exports do not generate new manifest revisions.

The default seven-day SQLite position window is a minimum: older rows remain until their completed day is verified and committed. Deleting a day and recording its prune receipt happen in one SQLite transaction. A crash before the private JSON state is saved cannot turn pruned history into an empty revision. Missing/corrupt state, conflicting committed history, or late rows for a pruned day stop archival work and retain rows for reconciliation. Other trip-update retention remains independent.

Retained completed days are revisited in bounded rotation for corrections; previous checksum-addressed revisions remain available. There is no automatic historical deletion. Back up both private state and public archive objects. The volume is persistent storage, not an off-host backup.

Archive coverage means these files contain the observations retained by this collector. An empty day or missing vehicle is not proof that service did not run. Collection begins at the first actual stored observation; past Atlanta/Chicago history is never relabeled. Today's incomplete day is not published, and DST produces 23- or 25-hour days where appropriate.

## Resources and commands

The scheduler tries the archive hourly, exporting or checking at most three days per run by default. It uses one DuckDB thread, a 256 MB buffer limit and a 128 MB spill limit. These are not process-RSS or total-disk caps; the staging database and output also need space. Export failure leaves source observations intact. Monitor `/api/health` and volume growth as permanent history accumulates.

Optional settings: `TRANSIT_ARCHIVE_DAY_LIMIT`, `TRANSIT_POSITION_RETENTION_DAYS`, `POSITIONS_MEMORY_LIMIT`, and `POSITIONS_MAX_TEMP_SIZE`. Defaults fit the initial one-service deployment; increase resource limits only after measurement.

Run the completed-day job manually with the same environment as the service:

```sh
npm run tarc:export-positions --workspace apps/insights
```

For a safe sample of today, point at the existing history database. The command opens it read-only, defaults to 5,000 rows, writes to a new OS temporary directory, and never publishes a pointer or prunes data:

```sh
TARC_HISTORY_DB_PATH=/path/to/tarc.sqlite npm run tarc:export-positions:dry --workspace apps/insights -- --date 2026-11-02 --limit-rows 5000
```

The output reports the sample directory and file metadata. Omit `--date` to use today's Louisville date. Use these files only for validation; they are partial samples, not production daily archives.

## Measured sample

On 2026-11-02, a read-only sample contained **2,698 rows, 12 routes, and 41 snapshots**, spanning 22:00:33–22:41:23 UTC. Independent PyArrow 26 checks verified all 12 fields as a multiset, exact IEEE-754 DOUBLE values, types, sorting, and ZSTD metadata. Separate synthetic records verified nulls and duplicate multiplicity because the real sample contained neither.

The same records occupied **64,223 bytes as gzip NDJSON** and **24,361 bytes as Parquet**, a **62.07% reduction** for this sample. The NDJSON baseline uses the former exporter’s timestamp ordering and gzip level 9. This is not a full-day size estimate or remote-query latency claim. [Machine-readable results](positions-validation-2026-11-02.json) contain hashes and validation details; raw observations are excluded from Git.
