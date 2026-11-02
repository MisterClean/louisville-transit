const { buildRollupThread } = require('../../src/shared/post');
const HOUR = 3600000;
function current(timestamp, enabledAt, now) {
  return (
    Number.isFinite(timestamp) &&
    timestamp > enabledAt &&
    timestamp <= now + 60000 &&
    timestamp >= now - HOUR
  );
}
function coverage(entry) {
  const s = entry.summary;
  return s && s.bins > 0 && s.covered >= 0 ? s.covered / s.bins : 0;
}
function crowdedFraction(entry) {
  const s = entry.summary;
  return s?.covered > 0 && Number.isFinite(s.orange) && Number.isFinite(s.red)
    ? (s.orange + s.red) / s.covered
    : 0;
}
function mapEligible(entry, kind, enabledAt, now) {
  if (
    entry.kind !== kind ||
    !entry.route ||
    !entry.image_url ||
    !current(entry.updated_at, enabledAt, now) ||
    !current(entry.generated_at, enabledAt, now) ||
    coverage(entry) < 0.3
  )
    return false;
  if (kind === 'speedmap')
    return Number.isFinite(entry.summary.avg) && entry.summary.avg >= 0 && entry.sample_count > 0;
  return (
    entry.sample_count >= 20 && entry.crowded_vehicle_count >= 1 && crowdedFraction(entry) >= 0.15
  );
}
function rollupEligible(row) {
  return (
    row.route != null &&
    row.total >= 15 &&
    row.pctCrowded >= 0.25 &&
    row.crowded >= 3 &&
    row.crowdedVehicles >= 1
  );
}
function analyticsCandidates({ media = {}, analytics = {}, enabledAt, now, history = [] }) {
  const results = [];
  const latest = (kind, route) =>
    Math.max(
      0,
      ...history
        .filter((row) => row.kind === kind && (!route || row.routes.includes(String(route))))
        .map((row) => row.timestamp),
    );
  for (const kind of ['speedmap', 'crowding']) {
    if (now - latest(kind) < HOUR) continue;
    const eligible = Object.values(media).filter((entry) =>
      mapEligible(entry, kind, enabledAt, now),
    );
    if (kind === 'speedmap')
      eligible.sort(
        (a, b) =>
          latest(kind, a.route) - latest(kind, b.route) ||
          String(a.route).localeCompare(String(b.route), undefined, { numeric: true }),
      );
    else
      eligible.sort(
        (a, b) =>
          crowdedFraction(b) - crowdedFraction(a) ||
          String(a.route).localeCompare(String(b.route), undefined, { numeric: true }),
      );
    const chosen = eligible.find(
      (entry) => kind !== 'crowding' || now - latest(kind, entry.route) >= 6 * HOUR,
    );
    if (!chosen) continue;
    const summary = chosen.summary;
    const title = `Route ${chosen.route}`;
    const coverageText = `${summary.covered}/${summary.bins} mapped segments`;
    const end = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Kentucky/Louisville',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(chosen.generated_at));
    const text =
      kind === 'speedmap'
        ? `${title} speedmap\nOne-hour observations ending ${end}.\nAverage observed speed: ${summary.avg.toFixed(1)} mph across ${coverageText}.`
        : `${title} crowding map\nOne-hour observations ending ${end}.\n${Math.round(crowdedFraction(chosen) * 100)}% of mapped segments standing-room or fuller (${coverageText}; ${chosen.sample_count} known-occupancy reports).`;
    const alt =
      kind === 'speedmap'
        ? `${text} Route segments are colored by average observed speed: red under 5 mph, orange under 10, yellow under 15, green 15 mph or higher; gray means unavailable.`
        : `${text} Route segments are colored by reported occupancy: green seats available, yellow few seats left, orange standing room, red full, gray unavailable.`;
    results.push({
      id: `analytics-${kind}-${chosen.route}-${Math.floor(chosen.updated_at / HOUR)}`,
      mode: 'bus',
      routes: [String(chosen.route)],
      analytics: {
        kind,
        generated_at: chosen.generated_at,
        summary,
        sample_count: chosen.sample_count,
        updated_at: chosen.updated_at,
      },
      text,
      alt,
      image_url: chosen.image_url,
    });
  }
  if (
    now - latest('crowding-rollup') >= 2 * HOUR &&
    current(analytics.generated_at, enabledAt, now)
  ) {
    const routes = (analytics.crowding_rollup || [])
      .filter(rollupEligible)
      .sort((a, b) => b.pctCrowded - a.pctCrowded || b.crowded - a.crowded)
      .slice(0, 10);
    if (routes.length >= 2) {
      const lines = routes.map(
        (row) =>
          `Route ${row.route}: ${Math.round(row.pctCrowded * 100)}% of ${row.total} known-occupancy reports standing-room or fuller`,
      );
      const posts = buildRollupThread('TARC crowding reports, past hour', lines);
      if (posts?.length)
        results.push({
          id: `analytics-crowding-rollup-${routes
            .map((r) => r.route)
            .sort()
            .join('-')}-${Math.floor(analytics.generated_at / (2 * HOUR))}`,
          mode: 'bus',
          routes: routes.map((r) => String(r.route)),
          analytics: {
            kind: 'crowding-rollup',
            generated_at: analytics.generated_at,
            routes,
            posts,
          },
          text: posts[0].text,
        });
    }
  }
  return results;
}
module.exports = { analyticsCandidates, mapEligible, rollupEligible };
