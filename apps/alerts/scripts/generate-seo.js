// Source-backed crawler pages and share cards for the SPA. Runs after export.
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { BUS_ROUTE_NAMES } from '../src/lib/busRoutes.js';

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c],
  );
const safeSegment = (value) => value != null && /^[A-Za-z0-9_-]+$/.test(String(value));
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const displayDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const site = 'Louisville Transit Alerts';
const headline = (incident) =>
  incident.official_alert?.headline ||
  incident.detections?.[0]?.description ||
  'TARC service disruption';
const countLabel = (n) => `${n} recorded incident${n === 1 ? '' : 's'}`;
function weekOf(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}
function words(text, max = 38, lines = 3) {
  const result = [];
  let current = '';
  for (const token of String(text).trim().split(/\s+/)) {
    const word = token.length > max ? `${token.slice(0, max - 1)}…` : token;
    if (current && `${current} ${word}`.length > max) {
      result.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) result.push(current);
  if (result.length > lines) {
    result.length = lines;
    result[lines - 1] = `${result[lines - 1].slice(0, max - 1)}…`;
  }
  return result;
}
function card(page, domain) {
  const title = words(page.cardTitle || page.title, 30, 3)
    .map(
      (line, i) =>
        `<text x="74" y="${230 + i * 72}" font-size="62" font-weight="800" fill="#0f172a">${escapeHtml(line)}</text>`,
    )
    .join('');
  const subtitle = words(page.cardSubtitle || page.description, 72, 2)
    .map(
      (line, i) =>
        `<text x="74" y="${465 + i * 35}" font-size="25" fill="#475569">${escapeHtml(line)}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x2="1" y2="0"><stop stop-color="#e0efff"/><stop offset="1" stop-color="#f8fafc"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><rect width="14" height="630" fill="#2563eb"/><rect x="74" y="64" rx="18" width="270" height="42" fill="#dbeafe"/><text x="92" y="92" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="700" fill="#1e40af">${escapeHtml(page.eyebrow || 'TARC BUS ALERTS')}</text><g font-family="DejaVu Sans, sans-serif">${title}${subtitle}<text x="74" y="578" font-size="21" font-weight="700" fill="#0f172a">${escapeHtml(domain || site)}</text><text x="1126" y="578" font-size="16" text-anchor="end" fill="#64748b">Independent transit data</text></g></svg>`;
}
async function atomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, value);
  await rename(temp, path);
}
async function unchanged(path, value) {
  try {
    return (await readFile(path, 'utf8')) === value;
  } catch {
    return false;
  }
}
export function buildSeoPages(
  incidents,
  routeKeys,
  { dataStartTs = null, generatedAt = Date.now() } = {},
) {
  const pages = [
    ['/', 'Home', 'Current TARC alerts and recorded bus disruptions in Louisville.'],
    ['/routes', 'All routes', 'Browse TARC bus routes and their recorded alert history.'],
    ['/calendar', 'Calendar', 'Explore recorded TARC incidents by day.'],
    ['/stats', 'Stats', 'Explore recorded TARC incident patterns and history.'],
    ['/compare', 'Compare routes', 'Compare recorded TARC bus route incidents.'],
    ['/week', 'This week', 'Explore recorded TARC incidents for the current week.'],
    ['/system/buses', 'Bus system health', 'Explore TARC bus alerts and recent observations.'],
    ['/about', 'About', 'About this independent TARC bus alert archive and its sources.'],
    ['/subscribe', 'Subscribe', 'Follow TARC alerts through global and route-specific feeds.'],
    ['/privacy', 'Privacy', 'Information about browser preferences and requests to this site.'],
  ].map(([path, title, description]) => ({ path, title, description, body: description }));
  for (const route of routeKeys) {
    if (!safeSegment(route)) continue;
    const subset = incidents.filter((i) => (i.routes || []).map(String).includes(String(route)));
    const name = BUS_ROUTE_NAMES[route];
    const routeTitle = `Route ${route}${name ? ` · ${name}` : ''}`;
    pages.push({
      path: `/route/${route}`,
      feedPath: `/feed/route/${route}.xml`,
      title: routeTitle,
      eyebrow: `TARC ROUTE ${route}`,
      description: `${routeTitle}: ${countLabel(subset.length)} in this archive.`,
      body: `${routeTitle}. ${countLabel(subset.length)} in this archive.`,
      cardTitle: `Route ${route}`,
      cardSubtitle: name || 'TARC bus route',
    });
  }
  const days = new Map();
  for (const i of incidents) {
    if (!safeSegment(i.id)) continue;
    const ts = i.lifecycle?.first_seen_ts;
    const date = Number.isFinite(ts) ? displayDate.format(new Date(ts)) : null;
    const desc = String(
      i.official_alert?.description || i.detections?.[0]?.description || headline(i),
    ).slice(0, 260);
    const status = i.lifecycle?.active ? 'Active' : 'Recorded';
    pages.push({
      path: `/event/${i.id}`,
      title: headline(i),
      eyebrow: status.toUpperCase(),
      description: desc,
      body: `${headline(i)}${date ? ` · ${date}` : ''}. ${desc}`,
      cardTitle: headline(i),
      cardSubtitle: `${date ? `First observed ${date} · ` : ''}${(i.routes || []).map((r) => `Route ${r}`).join(', ') || 'TARC bus service'}`,
    });
    const original = pages[pages.length - 1];
    pages.push({ ...original, path: `${original.path}/resolved`, canonicalPath: original.path });
    if (Number.isFinite(ts)) {
      const day = dateFormat.format(new Date(ts));
      days.set(day, (days.get(day) || 0) + 1);
    }
  }
  // Calendar drilldowns have useful metadata even when no incidents were recorded.
  // Limit the generated rolling calendar to a year and never assert quiet service.
  if (Number.isFinite(dataStartTs) && Number.isFinite(generatedAt)) {
    const first = Date.parse(
      `${dateFormat.format(new Date(Math.max(dataStartTs, generatedAt - 366 * 86400000)))}T12:00:00Z`,
    );
    const last = Date.parse(`${dateFormat.format(new Date(generatedAt))}T12:00:00Z`);
    for (let ts = first; ts <= last; ts += 86400000) {
      const day = new Date(ts).toISOString().slice(0, 10);
      if (!days.has(day)) days.set(day, 0);
    }
  }
  const weeks = new Map();
  for (const [day, count] of days) {
    const week = weekOf(day);
    weeks.set(week, (weeks.get(week) || 0) + count);
    pages.push({
      path: `/day/${day}`,
      title: `Incidents on ${day}`,
      description: count
        ? `${countLabel(count)} first seen on ${day}, Eastern Time.`
        : `Explore recorded TARC incidents on ${day}, Eastern Time.`,
      body: count
        ? `${countLabel(count)} first seen on ${day}, Eastern Time.`
        : `Explore recorded TARC incidents on ${day}, Eastern Time.`,
    });
  }
  for (const [week, count] of weeks)
    pages.push({
      path: `/week/${week}`,
      title: `Week of ${week}`,
      description: `${countLabel(count)} first seen during the week of ${week}, Eastern Time.`,
      body: `${countLabel(count)} first seen during the week of ${week}, Eastern Time.`,
    });
  return pages;
}
export function renderPage(shell, page, base, imagePath) {
  const fullTitle = page.path === '/' ? site : `${page.title} · ${site}`;
  const canonical = `${base}${page.canonicalPath || page.path}`;
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: fullTitle,
    description: page.description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: site, url: `${base}/` },
  }).replace(/</g, '\\u003c');
  const meta = `<link rel="canonical" href="${escapeHtml(canonical)}" /><meta property="og:url" content="${escapeHtml(canonical)}" /><meta property="og:image" content="${escapeHtml(`${base}${imagePath}`)}" /><meta property="og:image:alt" content="${escapeHtml(fullTitle)}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta name="twitter:title" content="${escapeHtml(fullTitle)}" /><meta name="twitter:description" content="${escapeHtml(page.description)}" /><meta name="twitter:image" content="${escapeHtml(`${base}${imagePath}`)}" />`;
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(fullTitle)}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escapeHtml(fullTitle)}" />`,
    )
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      '<meta name="twitter:card" content="summary" />',
      '<meta name="twitter:card" content="summary_large_image" />',
    )
    .replace('href="/feed.xml"', `href="${escapeHtml(page.feedPath || '/feed.xml')}"`)
    .replace('</head>', `${meta}<script type="application/ld+json">${structured}</script></head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root"></div><noscript><main><h1>${escapeHtml(fullTitle)}</h1><p>${escapeHtml(page.body)}</p><p>Transit data: Transit Authority of River City (TARC). Independent project.</p></main></noscript>`,
    );
}
export async function generateSeo({
  dir,
  base,
  incidents,
  routes,
  dataStartTs,
  generatedAt,
  shell: providedShell,
}) {
  const shell =
    providedShell ?? (await readFile(new URL('../dist/index.html', import.meta.url), 'utf8'));
  const pages = buildSeoPages(incidents, routes, { dataStartTs, generatedAt });
  const domain = base ? new URL(base).host : '';
  let cursor = 0;
  async function worker() {
    while (cursor < pages.length) {
      const page = pages[cursor++];
      const svg = card(page, domain);
      const digest = createHash('sha256').update(svg).digest('hex').slice(0, 24);
      const imagePath = `/data/og/${digest}.png`;
      const imageFile = join(dir, 'og', `${digest}.png`);
      const exists = await access(imageFile).then(
        () => true,
        () => false,
      );
      if (!exists) {
        const png = await sharp(Buffer.from(svg)).png().toBuffer();
        await atomic(imageFile, png);
      }
      const html = renderPage(shell, page, base, imagePath);
      const pagesRoot = resolve(dir, 'pages');
      const segments = page.path.split('/').filter(Boolean);
      if (!segments.every(safeSegment)) throw new Error('Unsafe SEO page path');
      const file = resolve(pagesRoot, ...segments, 'index.html');
      if (!file.startsWith(`${pagesRoot}${sep}`)) throw new Error('Unsafe SEO output path');
      if (!(await unchanged(file, html))) await atomic(file, html);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return pages;
}
