# Contributor instructions

- Use Node 24 and the root npm workspace lockfile.
- Keep the upstream frontend structure and visual language unless a change explicitly calls for redesign.
- TARC is bus-only. Never relabel rail infrastructure, old city history or guessed values as Louisville observations.
- Preserve static route IDs, public route labels, GTFS service dates and America/New_York semantics.
- Freshness, independent snapshots and contiguous coverage are part of every absence-based detector. Failed feeds must not resolve events.
- Keep incident state separate from posting state. Publishing is off by default; tests must use isolated state and fake social adapters.
- Never commit downloaded feeds, databases, credentials, personal paths or generated deployment state.
- Run `npm test`, both workspace lint commands and `npm run build` before a release. Record material validation limitations honestly.
- Do not change repository visibility or assert a blanket license before the open-source release checklist is complete.

## Development and release workflow

- Start issue work from a freshly fetched `origin/main` on a clean `codex/` branch. Check the diff against `origin/main` before committing so earlier work or unrelated local changes do not enter the issue commit.
- Use Node 24 and the root workspace for validation. The GitHub Actions gate runs both workspace lints, `npm test`, `npm run build`, and a root Docker build; native dependencies such as `better-sqlite3` and `sharp` must work in that container as well as locally.
- Open a focused pull request, wait for its CI to pass, then merge. After merging, verify the new `main` CI run and the Railway deployment for that exact merge commit; a successful deployment of an older commit does not validate the release.
- Production is the existing single Railway service with one replica and its persistent `/data` volume. Keep secrets in Railway variables, preserve the mount and runtime state, and verify that Railway builds the root Dockerfile (including Chromium for map rendering) and uses the intended start command and health check; do not assume `railway.json` was applied.
- After deployment reaches `SUCCESS`, check `/api/health` for successful jobs, fresh TARC sources, and storage status. `/healthz` establishes HTTP liveness only. Inspect build or runtime logs when a job or source is unhealthy.
- Generated map and social media files are cached. For a rendering change, preview with real GTFS route geometry locally, then verify a newly generated production image or post after its cache window; an older cached image does not show whether the new renderer works. Keep required map attribution visible.
