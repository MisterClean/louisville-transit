# Bluesky account handoff

Two dedicated accounts match Louisville's bus-only scope:

| Account | Suggested display name | Purpose |
| --- | --- | --- |
| Bus | Louisville Bus Insights | Observed bunching, gaps, missing buses, speed/crowding maps and clips |
| Alerts | Louisville Transit Alerts | Official TARC alerts, cancellations and correlated disruptions |

Handles are configurable and availability has not been checked. A suitable bio is: “Automated, independent observations of Louisville TARC service. Public TARC feeds; not affiliated with TARC. Data and methodology: [site URL].” Do not describe detector observations as agency announcements.

1. Create the two accounts and verify any email/video requirements directly with Bluesky.
2. Create revocable app passwords without direct-message access. Store them as private deployment variables, never in Git or chat documentation.
3. Configure `BLUESKY_BUS_IDENTIFIER`, `BLUESKY_BUS_APP_PASSWORD`, `BLUESKY_BUS_DID`, and their `BLUESKY_ALERTS_` counterparts. The stable DIDs pin the intended accounts even if their handles change.
4. Review local previews, map/video appearance, source links and alt text. Optional `MAPBOX_TOKEN` enables street basemaps; no-token maps explicitly show route geometry.
5. Verify authentication and pinned identities without posting. Then enable publishing only after the account and preview review is complete.

`TRANSIT_PUBLISH_ENABLED=false` is the deployed default. The first enabled run establishes a silent baseline, so historical incidents are not announced as new. Publication is limited by freshness, incident age, route cooldowns and daily caps. Root posts, video replies and resolution replies have independent persistent receipts and remain in the same account/thread. Uncertain writes reconcile against the frozen record's TID on the authoritative PDS before retrying.

Collector history and website exports work while publication is disabled. No account creation, profile changes, follows, messages or live posts are performed by installation.
