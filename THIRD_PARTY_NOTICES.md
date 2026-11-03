# Third-party notices

The collector, frontend, and supporting algorithms derive from Cailin Pitt's projects:

| Project | Reviewed revision | Role |
| --- | --- | --- |
| [Atlanta Transit Insights](https://github.com/cailinpitt/atlanta-transit-insights) | `279da7eec63826bc89d174483343079416d254e3` | Collector, detectors, renderers, storage, exports, social integration base |
| [Atlanta Transit Alerts](https://github.com/cailinpitt/atlanta-transit-alerts) | `753376ecf80793c113f3c224c6729fac4c9b75e6` | React interface and archive client base |
| [Chicago Transit Insights](https://github.com/cailinpitt/chicago-transit-insights) | `ddeea1b7af616b24dfdbc9d7c74e8b2f4b2042a8` | Original architecture and parity reference |
| [Chicago Transit Alerts](https://github.com/cailinpitt/chicago-transit-alerts) | `3d8ab6ac1cefa6c66a35a637e7f8be6d39c530c2` | Original interface and parity reference |

Upstream author: Cailin Pitt. Original copyright and source comments remain applicable. The insights package manifests declare ISC; frontend redistribution is unresolved as described in `LICENSE.md`.

The map renderer includes Twemoji artwork inherited from upstream. Twemoji graphics are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [Twemoji](https://github.com/twitter/twemoji). Runtime and build dependencies retain the licenses shipped in their packages. Generate a complete dependency/asset inventory as part of public release preparation.

TARC supplies static GTFS and GTFS realtime data through its [developer page](https://www.ridetarc.org/developers/). The source repository excludes downloaded transit data, databases, credentials, account sessions, and generated media. Route geometry, observations, and alerts are attributed to TARC in the application. Optional Protomaps basemaps use OpenStreetMap data and display © OpenStreetMap · Protomaps in each published image; see [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) and [Protomaps attribution](https://protomaps.com/legal).
