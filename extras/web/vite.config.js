import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' emits relative asset paths, so the same build works from a user
// subpath (gavinnntann.github.io/HLK-ZW-Fingerprint-Sensor/), a custom domain,
// or file:// — no rebuild needed if the deploy target moves.
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', sourcemap: true },
});
