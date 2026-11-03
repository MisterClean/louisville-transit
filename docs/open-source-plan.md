# Public source release checklist

The GitHub repository is currently private. The running Railway service and its `/data` volume are separate from repository visibility. Do not change visibility or describe the combined codebase as open source until the rights and history audit below are complete.

## Prepared

- [x] A local setup guide, contributor guide, security policy, and changelog are in the repository.
- [x] CI runs lint, fixture tests, a frontend build, and a production container build on pull requests and `main` pushes.
- [x] Runtime data, downloaded feeds, SQLite, Parquet, backups, credentials, and `.env` files are excluded from Git by `.gitignore` and `.dockerignore`.
- [x] Upstream project attribution and reviewed revisions are recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).
- [x] Production storage paths and backup requirements are described in [operations](operations.md) and [the archive contract](positions-archive.md).

## Required before changing visibility

1. **Record a public redistribution grant and a license.** The upstream Insights manifest declares ISC. The Atlanta Alerts frontend has no root LICENSE or package license at the reviewed revision. Confirm public redistribution, modification, and downstream reuse rights with the upstream author, or obtain an upstream LICENSE. Choose and add a license for Louisville-owned integration code without claiming ownership of upstream code. Update [LICENSE.md](../LICENSE.md) and this checklist with the evidence. Keep private correspondence private unless its sender consents to publication.
2. **Audit source and history.** Scan every Git revision and tracked file for credentials, private emails, local paths, runtime data, account sessions, and deployment-only settings. Check that any removal also removes the sensitive value from Git history. Inventory fonts, icons, Twemoji artwork, and dependencies. Preserve TARC and upstream attribution. Do not commit downloaded GTFS or collected history; TARC's public feed availability is not a blanket data redistribution license.
3. **Verify the release candidate.** On a clean Node 24 Linux checkout, run both workspace lint commands, `npm test`, `npm run build`, a Docker build, and a dependency advisory audit. Resolve or document material advisories. Test a fresh instance's warm-up states and verify backup/restore using disposable data.
4. **Protect `main` and connect deployment.** Require pull requests and the CI check on `main`, block force pushes and deletion, and review whether the owner account's GitHub plan enforces rules on a private repository. Connect Railway's production service to the GitHub `main` branch and enable Wait for CI. Preserve the existing `transit-state` volume mounted at `/data`, one replica, and the production variables. Verify the specific new deployment reaches `SUCCESS`, then verify feed freshness and volume mount.
5. **Publish deliberately.** Review the public README and release notes, confirm a current backup, make the repository public, and tag a reviewed release. Inspect the public tree immediately after publication. A public repository without an applicable license is source visible, not open source.

## Later improvements

- Set an off-host backup policy and restoration drill for the growing SQLite and Parquet history.
- Monitor feed freshness, deployment failures, and volume headroom; HTTP liveness alone is insufficient.
- Document schema compatibility in each release and avoid relabeling Atlanta or Chicago history as Louisville observations.

Suggested upstream contributions are small, independently reviewable changes: bus replay support, collector/archive independence from social posting, explicit feed-health states, static GTFS unit handling, and durable delivery reconciliation. No outreach or upstream pull request is implied by this checklist.
