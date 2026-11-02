// Auto-reload long-open tabs after a deploy ships new Vite-hashed assets.
//
// Why this exists: Vite emits content-hashed filenames like
// `/assets/index-C1xC-bEX.js`. A redeploy changes those hashes, and any
// open tab whose in-memory HTML still references the old hash will
// 404 on its CSS and render the page unstyled — exactly what the user
// reported with a tab left open overnight. A hard refresh fixes it
// because the browser re-fetches index.html and gets the new hashes.
//
// Strategy: capture the entry-chunk hash from the document at load time.
// When the tab regains focus after >5 min hidden, fetch the live
// index.html (bypassing the HTTP cache) and parse its entry-chunk hash.
// If it changed, reload — the user sees a fresh, styled page.
//
// Bails silently when:
//   * No /assets/ script in the DOM (dev mode — Vite serves ES modules
//     directly without hashes).
//   * The fetch fails (offline / transient network issue).
//   * Tab was hidden for less than the idle threshold.

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const ENTRY_HASH_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

function entryHashFrom(text) {
  const m = ENTRY_HASH_RE.exec(text);
  return m ? m[0] : null;
}

function currentEntryHash() {
  const scripts = document.querySelectorAll('script[src*="/assets/index-"]');
  for (const s of scripts) {
    const src = s.getAttribute('src') || s.src || '';
    const hash = entryHashFrom(src);
    if (hash) return hash;
  }
  return null;
}

export function installStaleAssetReload() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const initial = currentEntryHash();
  if (!initial) return;

  let hiddenSince = null;
  let checking = false;

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      return;
    }
    if (hiddenSince == null || Date.now() - hiddenSince < IDLE_THRESHOLD_MS) {
      hiddenSince = null;
      return;
    }
    hiddenSince = null;
    if (checking) return;
    checking = true;
    try {
      const resp = await fetch('/', { cache: 'no-store' });
      if (!resp.ok) return;
      const html = await resp.text();
      const fresh = entryHashFrom(html);
      if (fresh && fresh !== initial) {
        window.location.reload();
      }
    } catch (_e) {
      // Transient — don't reload. Next focus will retry.
    } finally {
      checking = false;
    }
  });
}
