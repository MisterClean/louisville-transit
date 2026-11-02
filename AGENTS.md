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
