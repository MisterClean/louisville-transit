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

## Limits and release gates

These checks do not establish months of operational reliability. History accumulates only while this installation is collecting; completed-day metrics require the documented source coverage threshold.

Publishing remains disabled until two bot accounts and their pinned DIDs are configured. Delivery tests exercise failure recovery with simulated transport, not real account posting.

The production dependency audit still reports the Bluesky SDK's transitive Zod advisory, GHSA-mrhx-c7xc-m3w5. The SDK transport has response-size, timeout, and structural bounds, and publishing is off by default. Track an upstream-compatible fix before public release.

Public source release also requires upstream frontend license clarification. See [the release plan](open-source-plan.md). Independent off-host backups require operational configuration; see [operations](operations.md).
