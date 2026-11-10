# Rendering reliability and remote browser options

The collector must prioritize fresh observations and exports. Native image operations and Chromium can fail independently of HTTP serving. Thread exhaustion can also come from process/PID limits; low RSS alone does not rule it out.

The proposed safeguards use Tini as container PID 1, clean up each job's remaining process group, bound libvips cache and libvips/libuv concurrency, stage lazy video frames one at a time with frame-count/byte budgets, close Chromium even when page cleanup fails, and apply timeouts plus retry backoff to optional jobs. Collection and public exports precede optional media, publishing and archiving. Optional job errors remain visible in `/api/health.jobs`; they do not become successful media runs. Failed schedule loads and refreshes remain fatal to collection: partially refreshed schedule files must never be used. Initialization retries back off from five minutes to one hour.

`/healthz` remains liveness. `/readyz` returns 503 unless the last successful cycle and all three required source timestamps are fresh. `/api/health.resources` includes process RSS and available Linux cgroup PID usage/limits/events for diagnosis. A scheduled assistant check independently reads runtime and feed health every 15 minutes, alerts after a confirmed 10-minute freshness breach, and reports recovery. It is not a substitute for a dedicated high-availability uptime monitor. No historical observations can be recovered merely by restarting.

## Does this require Cloudflare?

No. Lifecycle, resource bounds, failure isolation and monitoring are required regardless of browser location. Offloading Chromium would remove its resource demand from the collector, but Sharp/libvips, FFmpeg and orchestration still require safeguards.

Cloudflare's service is now called Browser Run. It supports direct Playwright/CDP from an existing Node server as well as a Worker with a browser binding; a custom Worker is optional. [Integration guide](https://developers.cloudflare.com/browser-run/get-started/), [Playwright/CDP](https://developers.cloudflare.com/browser-run/cdp/playwright/).

A promising follow-up is an authenticated render Worker: accept a bounded route/viewport specification, serve pinned MapLibre assets from the Worker, render to PNG, and return the image. Railway keeps collection, SQLite and archives. The current renderer serves modules on 127.0.0.1, which a remote browser cannot reach; simply replacing `launch()` with `connectOverCDP()` will not work. Alternatively, intercept the remote page's requests and fulfill the fixed local assets through Playwright. Preserve map attribution and use a render-complete signal with a deadline.

Use a private authenticated endpoint, payload/viewport limits, allowed resource origins, single-flight requests and a cache keyed by geometry, style and renderer version. Keep API credentials server-side and redact them from logs. Explicitly close sessions, handle 429/Retry-After and timeouts, and retain the labeled geometry fallback. Avoid arbitrary client-supplied navigation URLs.

Cloudflare reports WebGL support, making MapLibre plausible, but this exact MapLibre version, fonts, workers and image quality still require a real rendering proof of concept. [Cloudflare's platform update](https://blog.cloudflare.com/browser-run-containers/).

Free usage includes 10 browser minutes/day and three concurrent sessions. Paid usage includes 10 browser hours/month, then $0.09/hour, with 10 average concurrent sessions included and $2 per additional average concurrent browser. Workers plan and other infrastructure charges are separate. Paid concurrency's default limit is 200; the normal browser timeout is 60 seconds of inactivity. Close sessions promptly rather than keeping idle browsers alive. These are published terms checked November 10, 2026, not a measured cost estimate for this app. [Pricing](https://developers.cloudflare.com/browser-run/pricing/), [limits and lifecycle](https://developers.cloudflare.com/browser-run/limits/).

Before rollout: measure render count/duration and cache hit rate; test Protomaps failures, missing tiles, 429s, remote disconnection and invalid payloads; compare real route renders and attribution; then soak-test process counts and fresh collection through many render/retry cycles. No Cloudflare resources or credentials were provisioned as part of this research.

## Validation and release gate

Local Node 24 validation passes: 13 runtime tests, 554 collector tests, 365 frontend tests, both workspace lints (existing warnings), and the production frontend build. A real FFmpeg smoke check produces byte-identical MP4 output for array and lazy-generator input. Docker is unavailable locally, so Linux container build, PID-1 reaping under container limits, and a long-running rendering soak remain required before claiming the production fault is eliminated. The original exact process/thread limit could not be inspected without a configured SSH key.
