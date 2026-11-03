# Daily position archive storage

The production collector writes observations to SQLite on the Railway `/data` volume. An hourly archive job exports completed Louisville calendar days as ZSTD Parquet, verifies the file, and publishes immutable checksum-named files and manifests before updating `/data/positions/index.json`. The same Node service serves the Parquet files from `/data/positions/...` with HTTP range support. SQLite retains at least seven days of raw positions and prunes a completed day only after the archive is verified and committed. See [the archive contract](positions-archive.md).

There is currently no object bucket. The persistent volume holds SQLite, archive history, and other runtime state. Public archive downloads consume Railway service egress.

| Storage option | Storage price | Public archive download | Fit |
| --- | ---: | ---: | --- |
| Railway volume (current) | $0.15/GB-month of used space | $0.05/GB service egress | Simplest while the archive is small |
| Railway bucket | $0.015/GB-month | Free if clients use direct bucket URLs | Private bucket requires presigned URL redirects or app proxy |
| Cloudflare R2 Standard | First 10 GB-month free, then $0.015/GB-month | Free | Supports a stable public custom domain |

Railway bucket operations are free. R2 includes one million Class A writes and ten million Class B reads per month; usage beyond those allowances is billed. Uploading from the Railway service to either bucket still incurs Railway service egress. At **100 GB stored for a full month**, storage alone would be about $15 on the volume, $1.50 in a Railway bucket, or $1.35 in R2 if its free allowance is otherwise unused. Those figures exclude the app, SQLite, temporary export space, and plan minimum. The first measured Parquet subset covers less than a complete day, so it is not a reliable basis for an annual archive growth estimate.

R2 is the preferred long-term destination for public immutable archives. Keep SQLite and export staging on the Railway volume. A move should preserve the current publication invariant: upload each checksum-named file, verify size and hash remotely, publish its immutable manifest, then atomically update the remote index pointer. Gate SQLite pruning on remote verification, backfill and verify existing days, test range requests and CORS, and keep old `/data/positions/...` links working through redirects. Remove verified local archive copies only after the remote reader path is proven. Merely copying files to a bucket will not reduce volume charges.

Prices checked November 2026: [Railway resource pricing](https://docs.railway.com/pricing/plans), [Railway bucket billing](https://docs.railway.com/storage-buckets/billing), [Railway bucket serving](https://docs.railway.com/storage-buckets/uploading-serving), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).
