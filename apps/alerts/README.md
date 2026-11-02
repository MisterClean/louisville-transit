# Louisville Transit Alerts

Independent TARC bus alert archive. Transit data: [Transit Authority of River City](https://www.ridetarc.org/developers/). This project is not affiliated with TARC.

The frontend is adapted from [Atlanta Transit Alerts](https://github.com/cailinpitt/atlanta-transit-alerts). It reads same-origin `/data` snapshots produced by the insights service. Run `npm ci --workspaces=false` and `npm run build --workspaces=false` in this directory. Source health comes from `/api/health`.
