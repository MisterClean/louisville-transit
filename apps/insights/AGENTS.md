# Agent instructions

Production is the Louisville bus-only pipeline in `scripts/runtime`, not the inherited cron entrypoints. Read README.md first. Preserve source timestamps, route string IDs and leading zeroes, real warmup/freshness states, and independent alert/detector lifecycles. No fake social receipts or seeded incidents.

Run `npm test` and `npm run lint` before committing. Do not auto-commit, push, pull, or install crontabs. Do not hardcode usernames or secret values. Keep docs and exported schema contracts synchronized. Record skipped/unposted detections independently of delivery; callouts are computed before recording. Explicit user instructions take precedence.

Inherited rail/streetcar modules are historical upstream compatibility helpers/tests. Production must not fetch those agencies/modes or expose them as TARC features. The historical docs are labeled accordingly. Shared detector thresholds must retain meaningful tests.
