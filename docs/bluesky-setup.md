# Bluesky publisher setup

One account publishes both official TARC alerts and independently observed bus-service events:

| Account | Display name | Purpose |
| --- | --- | --- |
| [@tarctransitalerts.app](https://bsky.app/profile/tarctransitalerts.app) | Louisville Transit Alerts | Official alerts, bus observations, speed/crowding maps and clips |

The account DID is `did:plc:ijus5maesleyleeumnub2c77`. The root-domain handle is verified by the `_atproto.tarctransitalerts.app` TXT record. Its public profile has an independent/unofficial bio, the live dashboard link, the automation label, and the tracked bus avatar in `branding/bluesky-bus-avatar.svg`: a blue TARC-style bus front whose LED destination sign reads `502`, with no TARC logo or wordmark. The SVG is generated; change `apps/insights/scripts/tarc/draw-bus-avatar.js` (its palette is at the top), then from the monorepo root run `node apps/insights/scripts/tarc/draw-bus-avatar.js` followed by `node apps/insights/scripts/tarc/render-bus-avatar.js` to rebuild the PNG. Add `--alert-badge --out=<file>.svg` to the first command for a variant with a red alert badge. The production `BLUESKY_ALERTS_*` variables authenticate to the pinned DID without posting. Do not describe detector observations as agency announcements.

1. Use a revocable app password without direct-message access. Store it as private `BLUESKY_ALERTS_APP_PASSWORD` in the Railway production service, never in Git or chat documentation.
2. Set `BLUESKY_ALERTS_IDENTIFIER=tarctransitalerts.app` and `BLUESKY_ALERTS_DID=did:plc:ijus5maesleyleeumnub2c77`. The DID pins the intended account even if its handle changes. Leave all `BLUESKY_BUS_*` variables unset for single-account publishing.
3. Review local previews, map/video appearance, source links and alt text. Optional `PROTOMAPS_KEY` enables Protomaps street basemaps when Chromium is installed. Without a key, maps and clips show labeled route geometry. With a key, still maps may use the labeled geometry fallback if the provider fails; clips wait and retry rather than publish without streets. Published maps include OpenStreetMap and Protomaps attribution.

The [hosted Protomaps API](https://protomaps.com/api) is free for noncommercial use; commercial use requires sponsorship. The basemap is an [OpenStreetMap-derived produced work](https://docs.protomaps.com/basemaps/downloads), so keep attribution visible in every published image.
4. Verify authentication and pinned identity without posting. Enable publishing only after the account and preview review is complete.

`TRANSIT_PUBLISH_ENABLED=false` is the deployed default. The first enabled run establishes a silent baseline, so historical incidents are not announced as new. Publication is limited by freshness, incident age, route cooldowns and daily caps. Root posts, video replies and resolution replies have independent persistent receipts and remain in the same account/thread. Uncertain writes reconcile against the frozen record's TID on the authoritative PDS before retrying. A future second account can be configured with all three `BLUESKY_BUS_*` variables; existing outbox entries retain their original account and DID.

Production publishing was enabled on November 2, 2026. Railway deployment `7be4ea17-bca7-43bc-ab7c-223ac543fd88` completed successfully, and its first publisher cycle logged `{"baseline":true,"posted":0}`. The live health endpoint reported a successful publish job and fresh TARC sources. The public account still had zero posts after that baseline; the first post will require a new eligible event.

Collector history and website exports work while publication is disabled. No account creation, profile changes, follows, messages or live posts are performed by installation.
