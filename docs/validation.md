# Validation record

Reviewed on 2026-11-02 with Node 24.

## Local release checks

- 894 tests passed: 4 runtime, 528 collector, and 362 frontend tests.
- Both workspace linters and the production frontend build passed.
- Live TARC static and realtime feeds were exercised without API credentials. Schedule import identified 14 bus routes; realtime observations, official alerts, route exports, analytics, and replay were verified.
- Desktop and 390-pixel mobile views were inspected, including dark mode, a route page, official alert links, and bus replay controls. New installations show unknown history instead of fabricated incident-free days.
- Dynamic schedule refresh was tested with an added route and renamed route, including generated route feeds and SEO pages.
- HTTP integration checks cover generated pages, data responses, health endpoints, caching, and path containment. Local artifact checks cover Atom, CSV, sitemap, canonical metadata, and sharing cards.
- SQLite backup creation and checksum/integrity verification passed. Video encoding was exercised with FFmpeg; no social post was sent.
- The source tree was scanned for credentials and personal account names, emails, and filesystem paths. Git author metadata is generic; deployment account ownership is not embedded in the application.

## Production smoke check

The runtime revision `80c79165e33782cf7c7f0aa29b52e27f10618238` passed GitHub Actions on Linux and deployed successfully to Railway on 2026-11-02. It was uploaded from the reviewed checkout using the CLI; GitHub integration access was not expanded and automatic deployment on push is not enabled.

At 22:36 UTC, the new instance had completed two collection cycles with zero failures. All three feed timestamps advanced independently: 65 vehicle positions, 195 trip updates, and one official alert were fresh. The archive start remained stable, the coverage ledger gained 60 seconds of observed time, and a real incident replay track was exported.

HTTPS checks passed for liveness, runtime/source health, routes, vehicles, archive data, route/event pages, global/route Atom feeds, CSV, sitemap, canonical URLs, and a PNG sharing card. Route geometry was served compressed. Desktop and mobile production pages were visually inspected.

Railway mounted the persistent volume at `/data`; schedule indexes, SQLite state, and web exports were written there. A deliberate production restart/restore drill was not performed. Initial resource samples showed about 154 MB memory and 93 MB disk use; this brief startup window does not establish steady-state peaks or a monthly cost estimate. The configured limits remain one replica, 1 vCPU, 1 GB memory, and a 1 GB persistent volume.

## Limits and release gates

These checks do not establish months of operational reliability. History accumulates only while this installation is collecting; completed-day metrics require the documented source coverage threshold.

Publishing remains disabled until two bot accounts and their pinned DIDs are configured. Delivery tests exercise failure recovery with simulated transport, not real account posting.

The production dependency audit still reports the Bluesky SDK's transitive Zod advisory, GHSA-mrhx-c7xc-m3w5. The SDK transport has response-size, timeout, and structural bounds, and publishing is off by default. Track an upstream-compatible fix before public release.

Public source release also requires upstream frontend license clarification. See [the release plan](open-source-plan.md). Independent off-host backups require operational configuration; see [operations](operations.md).
