import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Copy `index.html` to `404.html` after build. GitHub Pages serves `404.html`
// for any path it can't match (e.g. `/event/abc`); making it identical to
// `index.html` boots the SPA so client-side routing can take over.
function spaFallback() {
  return {
    name: 'spa-fallback',
    apply: 'build',
    closeBundle() {
      const out = this.environment?.config?.build?.outDir ?? 'dist';
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), spaFallback()],
  base: '/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
});
