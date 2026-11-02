import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildSeoPages, generateSeo, renderPage } from '../../scripts/generate-seo.js';

const shell =
  '<html><head><title>Old</title><meta name="description" content="old" /><meta property="og:title" content="old" /><meta property="og:description" content="old" /></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';
const incidents = [
  {
    id: '188',
    mode: 'bus',
    routes: ['76'],
    lifecycle: { first_seen_ts: Date.parse('2026-11-02T03:30:00Z'), active: true },
    official_alert: { headline: 'Route 76 <detour> & delay', description: 'Use "alternate" stop' },
    detections: [],
  },
];

describe('published SEO pages', () => {
  it('derives route, event, day and week pages from recorded data in Eastern time', () => {
    const pages = buildSeoPages(incidents, new Set(['01', '76']));
    expect(pages.find((p) => p.path === '/route/01').body).toContain('0 recorded incidents');
    expect(pages.find((p) => p.path === '/route/76').body).toContain('1 recorded incident');
    expect(pages.find((p) => p.path === '/route/01').feedPath).toBe('/feed/route/01.xml');
    expect(pages.find((p) => p.path === '/event/188').title).toBe('Route 76 <detour> & delay');
    expect(pages.find((p) => p.path === '/day/2026-11-01')).toBeDefined();
    expect(pages.find((p) => p.path === '/week/2026-11-01')).toBeDefined();
  });
  it('makes empty calendar pages without claiming unobserved time was quiet', () => {
    const dataStartTs = Date.parse('2026-11-01T16:00:00Z');
    const generatedAt = Date.parse('2026-11-03T16:00:00Z');
    const pages = buildSeoPages([], new Set(), { dataStartTs, generatedAt });
    const page = pages.find((entry) => entry.path === '/day/2026-11-02');
    expect(page.description).toContain('Explore recorded');
    expect(page.description).not.toMatch(/all clear|incident.free|no incidents/i);
    expect(pages.find((entry) => entry.path === '/day/2026-10-31')).toBeUndefined();
  });
  it('escapes source text and emits canonical, card and crawler content without changing the SPA', () => {
    const page = buildSeoPages(incidents, new Set()).find((p) => p.path === '/event/188');
    const html = renderPage(shell, page, 'https://example.org', '/data/og/example.png');
    expect(html).toContain('Route 76 &lt;detour&gt; &amp; delay');
    expect(html).toContain('Use &quot;alternate&quot; stop');
    expect(html).toContain('href="https://example.org/event/188"');
    expect(html).toContain('content="https://example.org/data/og/example.png"');
    expect(html).toContain('<noscript>');
    expect(html).toContain('<script src="/assets/app.js"></script>');
    expect(html).not.toContain('atlantatransitalerts');
  });
  it('does not generate file paths from unsafe identifiers', () => {
    const pages = buildSeoPages(
      [{ ...incidents[0], id: '../escape' }],
      new Set(['../escape', '.', '..', 'a/b', 'a\\b']),
    );
    expect(
      pages.some(
        (p) => p.path.includes('escape') || p.path === '/route/..' || p.path === '/route/.',
      ),
    ).toBe(false);
  });
  it('writes PNG cards and changes their URL when incident content changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tarc-seo-test-'));
    try {
      const options = {
        dir,
        base: 'https://example.org',
        incidents,
        routes: new Set(['76']),
        shell,
      };
      await generateSeo(options);
      const path = join(dir, 'pages/event/188/index.html');
      const first = await readFile(path, 'utf8');
      const firstImage = first.match(
        /og:image" content="https:\/\/example.org\/data\/og\/([a-f0-9]+)\.png/,
      )[1];
      const metadata = await sharp(join(dir, 'og', `${firstImage}.png`)).metadata();
      expect([metadata.width, metadata.height]).toEqual([1200, 630]);
      const edited = structuredClone(incidents);
      edited[0].official_alert.headline = 'Detour updated';
      await generateSeo({ ...options, incidents: edited });
      const second = await readFile(path, 'utf8');
      expect(second).toContain('Detour updated');
      expect(second).not.toContain(`/data/og/${firstImage}.png`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
