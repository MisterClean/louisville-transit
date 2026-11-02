# Public release plan

The private repository is a working port. Publication requires the following concrete release work; changing visibility is a separate action.

1. **Resolve upstream licensing.** Obtain a clear license or redistribution permission for Atlanta/Chicago Alerts from Cailin Pitt. Preserve the upstream notices and reviewed revisions. Confirm the collector's ISC declaration and choose a compatible license for new integration code. Do not label the entire fork MIT/ISC before this is resolved.
2. **Confirm data and asset rights.** Record TARC feed attribution, reuse conditions and polling expectations. Inventory fonts, icons, Twemoji artwork, optional map providers and dependencies. Do not include downloaded GTFS, observed vehicle history or account material in the source release.
3. **Complete the release audit.** Run the full test, lint and production-build checks on Linux; audit dependencies and track the remaining Bluesky SDK/Zod advisory. Scan the tracked tree and Git history for credentials, personal paths, private emails, telemetry IDs, sessions and deployment-only settings. Generic contributor metadata should remain the default.
4. **Document the extension points.** Keep the two applications and shared runtime understandable. The agency adapter, timezone, route identity, feed URLs, schedule semantics and evidence rules are the porting boundary. Do not promise a universal agency plugin interface until another port exercises it.
5. **Prepare community maintenance.** Add contribution/security guidance, a reproducible local setup, example environment variables, issue templates for data-quality versus UI defects, fixture provenance, and a changelog with schema compatibility notes.
6. **Release deliberately.** Verify that a clean checkout runs without secrets, a fresh instance shows honest warm-up states, deployment preserves SQLite state, backups restore, and publishing remains opt-in. Tag the reviewed revision and publish the repository after licensing and privacy checks pass.

Suggested upstream contributions are small, independently reviewable changes: bus replay support, collector/archive independence from social posting, explicit feed-health states, static GTFS unit handling, and durable delivery reconciliation. No messages or pull requests are sent automatically.
