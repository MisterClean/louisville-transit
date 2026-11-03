# Public source release checklist

The GitHub repository is currently private. The running Railway service and its `/data` volume are separate from repository visibility. Do not change visibility or describe the combined codebase as open source until the rights and history audit below are complete.

## Prepared

- [x] A local setup guide, contributor guide, security policy, and changelog are in the repository.
- [x] CI runs lint, fixture tests, a frontend build, and a production container build on pull requests and `main` pushes.
- [x] Runtime data, downloaded feeds, SQLite, Parquet, backups, credentials, and `.env` files are excluded from Git by `.gitignore` and `.dockerignore`.
- [x] Upstream project attribution and reviewed revisions are recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).
- [x] Production storage paths and backup requirements are described in [operations](operations.md) and [the archive contract](positions-archive.md).
- [x] A `main` ruleset is configured for pull requests, the GitHub Actions `Test and build` check, current branches, conversation resolution, and no force pushes or deletion. GitHub says it is **not enforced while this personal repository is private** on the current plan.
- [x] GitHub's dependency graph, Dependabot alerts, malware alerts, and security-update pull requests are enabled. A high-severity transitive Zod advisory remains open and must be evaluated before release.
- [x] Railway's existing production service is connected to this repository's `main` branch with Wait for CI enabled. The GitHub-sourced deployment reached `SUCCESS`; `/api/health` reported healthy, fresh vehicle/trip/alert feeds, and the same `transit-state` volume remained mounted at `/data`.
- [ ] A recoverable off-host backup has been confirmed. Railway currently shows no backups for this service; the dashboard requires a Pro plan for its backup feature.

## Required before changing visibility

1. **Record a public redistribution grant and a license.** The upstream Insights manifest declares ISC. The Atlanta Alerts frontend has no root LICENSE or package license at the reviewed revision. Confirm public redistribution, modification, and downstream reuse rights with the upstream author, or obtain an upstream LICENSE. Choose and add a license for Louisville-owned integration code without claiming ownership of upstream code. Update [LICENSE.md](../LICENSE.md) and this checklist with the evidence. Keep private correspondence private unless its sender consents to publication.
2. **Audit source and history.** Scan every Git revision and tracked file for credentials, private emails, local paths, runtime data, account sessions, and deployment-only settings. Check that any removal also removes the sensitive value from Git history. Inventory fonts, icons, Twemoji artwork, and dependencies. Preserve TARC and upstream attribution. Do not commit downloaded GTFS or collected history; TARC's public feed availability is not a blanket data redistribution license.
3. **Verify the release candidate.** On a clean Node 24 Linux checkout, run both workspace lint commands, `npm test`, `npm run build`, a Docker build, and a dependency advisory audit. Resolve or document material advisories. Test a fresh instance's warm-up states and verify backup/restore using disposable data.
4. **Verify release gates.** Confirm a current, recoverable backup of the SQLite database and Parquet archive outside the Railway volume. Recheck the `main` CI job, production health and feed freshness, the `/data` mount, and the intended GitHub App repository scope.
5. **Publish deliberately.** Review the public README and release notes, make the repository public, and immediately verify the `main` ruleset is enforced. Tag a reviewed release and inspect the public tree. A public repository without an applicable license is source visible, not open source.

## Later improvements

- Set an off-host backup policy and restoration drill for the growing SQLite and Parquet history.
- Monitor feed freshness, deployment failures, and volume headroom; HTTP liveness alone is insufficient.
- Document schema compatibility in each release and avoid relabeling Atlanta or Chicago history as Louisville observations.

Suggested upstream contributions are small, independently reviewable changes: bus replay support, collector/archive independence from social posting, explicit feed-health states, static GTFS unit handling, and durable delivery reconciliation. No outreach or upstream pull request is implied by this checklist.
