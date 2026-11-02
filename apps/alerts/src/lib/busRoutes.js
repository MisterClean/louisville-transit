// TARC route names keyed by GTFS route_short_name.
export const BUS_ROUTE_NAMES = {
  '01': 'Broadway – Bardstown',
  '03': 'Preston Highway – West Market',
  '04': 'Fourth Street – New Cut',
  '05': 'Portland – Poplar Level',
  '08': 'Shelbyville Road – Taylor Boulevard',
  10: 'Dixie Highway',
  20: 'Eastern Parkway',
  71: 'New Albany – IUS',
  72: 'Clarksville',
  76: 'Jeffersonville',
  81: 'Downtown – Zorn',
  93: 'UPS UofL Shuttle',
  94: 'Cardinal Shuttle',
  99: 'UPS West Louisville Shuttle',
};

/**
 * Returns the display name for a bus route, or null if unknown.
 * @param {string|number} routeId
 * @returns {string|null}
 */
export function busRouteName(routeId) {
  return BUS_ROUTE_NAMES[routeId] ?? BUS_ROUTE_NAMES[String(routeId)] ?? null;
}

/**
 * Formats a bus route as `#121 Memorial Drive OTP / Pleasantdale` (or `#121` when unknown).
 * @param {string|number} routeId
 * @returns {string}
 */
export function formatBusRoute(routeId) {
  const name = busRouteName(routeId);
  const prefix = `#${routeId}`;
  return name ? `${prefix} ${name}` : prefix;
}

export function compareBusRoutes(a, b) {
  const sa = String(a);
  const sb = String(b);
  // Numeric routes sort numerically; non-numeric keys (e.g. "A") fall through
  // the NaN handling below and sort to the end.
  const ma = sa.match(/\d+/);
  const mb = sb.match(/\d+/);
  const na = ma ? parseInt(ma[0], 10) : Number.NaN;
  const nb = mb ? parseInt(mb[0], 10) : Number.NaN;
  if (Number.isNaN(na) && Number.isNaN(nb)) return sa.localeCompare(sb);
  if (Number.isNaN(na)) return 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb || sa.localeCompare(sb);
}

// Current GTFS roster is distinct from the name lookup: the latter retains
// earlier names so archived incidents remain readable after a route disappears.
let snapshot = {
  routes: Object.keys(BUS_ROUTE_NAMES).sort(compareBusRoutes),
  names: { ...BUS_ROUTE_NAMES },
  ids: {},
};
const listeners = new Set();
export const getRouteCatalog = () => snapshot;
export function subscribeRouteCatalog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyRouteCatalog(payload) {
  if (!Array.isArray(payload?.routes) || payload.routes.length === 0) return false;
  const current = new Map();
  for (const item of payload.routes) {
    if (typeof item?.route !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.route)) continue;
    const label = item.route;
    if (['__proto__', 'prototype', 'constructor'].includes(label)) continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 250) : '';
    const id = typeof item.id === 'string' ? item.id : null;
    if (!current.has(label)) current.set(label, { name, id });
  }
  if (!current.size) return false;
  const names = { ...snapshot.names };
  const ids = {};
  for (const [label, entry] of current) {
    if (entry.name) names[label] = entry.name;
    else if (!names[label]) names[label] = label;
    if (entry.id !== null) ids[label] = entry.id;
  }
  const routes = [...current.keys()].sort(compareBusRoutes);
  if (JSON.stringify({ routes, names, ids }) === JSON.stringify(snapshot)) return false;
  Object.assign(BUS_ROUTE_NAMES, names);
  snapshot = { routes, names, ids };
  for (const listener of listeners) listener();
  return true;
}

export async function refreshRouteCatalog() {
  try {
    const response = await fetch('/data/routes.json', { cache: 'no-cache' });
    if (!response.ok) return false;
    return applyRouteCatalog(await response.json());
  } catch {
    return false;
  }
}
