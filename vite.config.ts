import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

/**
 * Stamp a per-build id into the service worker (client/public/sw.js).
 *
 * The worker's cache name was a constant, so a deploy never replaced what it
 * had stored and unhashed files stayed frozen on every device. A new id per
 * build changes the worker's bytes, which is what makes the browser install the
 * new one, and names a fresh cache it can drop the old ones for.
 */
function serviceWorkerBuildId(): Plugin {
  let outDir = '';
  return {
    name: 'sw-build-id',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!fs.existsSync(file)) return;
      // The commit names the deploy; the timestamp keeps a rebuild of the same
      // commit from reusing a cache an earlier build of it filled.
      const commit = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 12);
      const source = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, source.replace(/__BUILD_ID__/g, `${commit}-${Date.now().toString(36)}`));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerBuildId()],
  root: 'client',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
