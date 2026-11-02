// Generate public artifacts from the same published incident snapshots as the UI.
// Run after each successful export. No network access or bundled history required.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyRouteCatalog, getRouteCatalog } from '../src/lib/busRoutes.js';
import { generateSeo } from './generate-seo.js';

const dir = process.env.TRANSIT_WEB_DIR || '/data/web';
const base = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const read = async (file) => JSON.parse(await readFile(join(dir, file), 'utf8'));
const xml = (value) =>
  String(value ?? '').replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );
const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const url = (path) => `${base}${path}`;
async function write(file, content) {
  const path = join(dir, file);
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

const index = await read('alerts-index.json');
const shards = await Promise.all((index.months || []).map((month) => read(month.url)));
const recent = await read('alerts-recent.json');
const unique = new Map();
for (const payload of [...shards, recent])
  for (const incident of payload.incidents || []) unique.set(incident.id, incident);
const incidents = [...unique.values()]
  .filter((incident) => incident.mode === 'bus')
  .sort((a, b) => (b.lifecycle?.first_seen_ts || 0) - (a.lifecycle?.first_seen_ts || 0));
const updated = new Date(recent.generated_at || Date.now()).toISOString();
const title = (i) =>
  i.official_alert?.headline || i.detections?.[0]?.description || 'TARC service disruption';
const timestamp = (i) =>
  new Date(
    i.lifecycle?.resolved_ts || i.lifecycle?.first_seen_ts || recent.generated_at || Date.now(),
  ).toISOString();
function atom(items, feedTitle, feedPath) {
  const entries = items
    .slice(0, 50)
    .map(
      (i) =>
        `<entry><id>${xml(url(`/event/${encodeURIComponent(i.id)}`))}</id><title>${xml(title(i))}</title><updated>${timestamp(i)}</updated><link href="${xml(url(`/event/${encodeURIComponent(i.id)}`))}"/><summary>${xml(i.official_alert?.description || '')}</summary></entry>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xml(url(feedPath))}</id><title>${xml(feedTitle)}</title><updated>${updated}</updated><link rel="self" href="${xml(url(feedPath))}"/>${entries}</feed>\n`;
}
function jsonFeed(items, feedTitle, feedPath) {
  return `${JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: feedTitle, home_page_url: url('/'), feed_url: url(feedPath), items: items.slice(0, 50).map((i) => ({ id: String(i.id), url: url(`/event/${encodeURIComponent(i.id)}`), title: title(i), content_text: i.official_alert?.description || title(i), date_modified: timestamp(i) })) }, null, 2)}\n`;
}
await write('feed.xml', atom(incidents, 'Louisville Transit Alerts', '/feed.xml'));
await write('feed.json', jsonFeed(incidents, 'Louisville Transit Alerts', '/feed.json'));
try {
  applyRouteCatalog(await read('routes.json'));
} catch {
  /* use the bundled roster until the schedule is available */
}
const routes = new Set([
  ...getRouteCatalog().routes,
  ...incidents.flatMap((i) => i.routes || []).map(String),
]);
for (const route of routes) {
  const subset = incidents.filter((i) => (i.routes || []).map(String).includes(route));
  const path = `/feed/route/${encodeURIComponent(route)}`;
  await write(
    `feed/route/${encodeURIComponent(route)}.xml`,
    atom(subset, `TARC route ${route} alerts`, `${path}.xml`),
  );
  await write(
    `feed/route/${encodeURIComponent(route)}.json`,
    jsonFeed(subset, `TARC route ${route} alerts`, `${path}.json`),
  );
}
const columns = [
  'id',
  'agency',
  'mode',
  'routes',
  'headline',
  'description',
  'first_seen_ts',
  'resolved_ts',
  'active',
];
await write(
  'alerts.csv',
  `${columns.join(',')}\n${incidents.map((i) => [i.id, i.agency, i.mode, (i.routes || []).join(';'), title(i), i.official_alert?.description, i.lifecycle?.first_seen_ts, i.lifecycle?.resolved_ts, i.lifecycle?.active].map(csv).join(',')).join('\n')}\n`,
);
const pages = await generateSeo({
  dir,
  base,
  incidents,
  routes,
  dataStartTs: index.data_start_ts ?? recent.data_start_ts,
  generatedAt: recent.generated_at,
});
const paths = pages.filter((page) => !page.canonicalPath).map((page) => page.path);
await write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${xml(url(path))}</loc></url>`).join('')}</urlset>\n`,
);
