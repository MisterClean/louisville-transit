import { dataUrl } from './dataSource.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export async function fetchAccessibilityData() {
  const res = await fetch(dataUrl('accessibility.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function outageDuration(outage, now = Date.now()) {
  const start = outage?.lifecycle?.first_seen_ts;
  if (start == null) return 0;
  const end = outage.lifecycle.restored_ts ?? (outage.lifecycle.active ? now : null);
  return end == null ? 0 : Math.max(0, end - start);
}

export function currentlyOut(outages = [], { now = Date.now(), line = null } = {}) {
  return outages
    .filter((o) => o.lifecycle?.active)
    .filter((o) => !line || (o.station?.lines || []).includes(line))
    .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
    .sort((a, b) => b.durationMs - a.durationMs || stationLabel(a).localeCompare(stationLabel(b)));
}

export function stationLabel(outage) {
  return outage?.station?.name || 'Unmatched station';
}

export function summarizeOutages(outages = []) {
  const stations = new Set();
  for (const o of outages) {
    stations.add(o.station?.slug || `unmatched:${stationLabel(o)}`);
  }
  return { total: outages.length, stations: stations.size };
}

// Collapses active outages into one group per station so a stop with several
// out-of-service units (e.g. an elevator and an escalator) reads as a single
// card. Stations keep the order of their first outage in the input, so a list
// pre-sorted by duration surfaces the longest-out station first.
export function groupOutagesByStation(outages = []) {
  const groups = new Map();
  for (const o of outages) {
    const key = o.station?.slug || `unmatched:${stationLabel(o)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: stationLabel(o),
        slug: o.station?.slug ?? null,
        lines: o.station?.lines || [],
        outages: [],
      });
    }
    groups.get(key).outages.push(o);
  }
  return [...groups.values()];
}

export function outagesForStation(outages = [], slug, { now = Date.now(), limit = 8 } = {}) {
  if (!slug) return [];
  return outages
    .filter((o) => o.station?.slug === slug)
    .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
    .sort((a, b) => {
      if (a.lifecycle?.active !== b.lifecycle?.active) return a.lifecycle?.active ? -1 : 1;
      return (b.lifecycle?.first_seen_ts || 0) - (a.lifecycle?.first_seen_ts || 0);
    })
    .slice(0, limit);
}

export function outagesForLine(outages = [], line, { now = Date.now(), limit = 8 } = {}) {
  if (!line) return [];
  return outages
    .filter((o) => (o.station?.lines || []).includes(line))
    .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
    .sort((a, b) => {
      if (a.lifecycle?.active !== b.lifecycle?.active) return a.lifecycle?.active ? -1 : 1;
      return (b.lifecycle?.first_seen_ts || 0) - (a.lifecycle?.first_seen_ts || 0);
    })
    .slice(0, limit);
}

export function stationReliability(
  outages = [],
  { now = Date.now(), windowDays = 90, line = null } = {},
) {
  const cutoff = now - windowDays * DAY_MS;
  const byStation = new Map();
  for (const outage of outages) {
    if (line && !(outage.station?.lines || []).includes(line)) continue;
    const start = outage.lifecycle?.first_seen_ts;
    if (start == null) continue;
    const restored = outage.lifecycle?.restored_ts ?? (outage.lifecycle?.active ? now : null);
    if (restored != null && restored < cutoff) continue;
    const key = outage.station?.slug || `unmatched:${stationLabel(outage)}`;
    if (!byStation.has(key)) {
      byStation.set(key, {
        slug: outage.station?.slug ?? null,
        name: stationLabel(outage),
        lines: outage.station?.lines || [],
        outageCount: 0,
        totalDownMs: 0,
        currentlyOut: 0,
        weeklyDownMs: Array.from({ length: Math.ceil(windowDays / 7) }, () => 0),
      });
    }
    const rec = byStation.get(key);
    const boundedStart = Math.max(start, cutoff);
    const boundedEnd = Math.max(boundedStart, restored ?? now);
    rec.outageCount += 1;
    rec.totalDownMs += Math.max(0, boundedEnd - boundedStart);
    if (outage.lifecycle?.active) rec.currentlyOut += 1;
    addWeeklyDurations(rec.weeklyDownMs, boundedStart, boundedEnd, cutoff);
  }
  return [...byStation.values()].sort(
    (a, b) =>
      b.currentlyOut - a.currentlyOut ||
      b.totalDownMs - a.totalDownMs ||
      b.outageCount - a.outageCount ||
      a.name.localeCompare(b.name),
  );
}

function addWeeklyDurations(buckets, start, end, cutoff) {
  let cursor = start;
  while (cursor < end) {
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor((cursor - cutoff) / WEEK_MS)));
    const next = Math.min(end, cutoff + (idx + 1) * WEEK_MS);
    buckets[idx] += Math.max(0, next - cursor);
    cursor = next;
  }
}
