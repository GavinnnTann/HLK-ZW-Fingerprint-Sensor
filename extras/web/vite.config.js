import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' emits relative asset paths, so the same build works from a user
// subpath (gavinnntann.github.io/HLK-ZW-Fingerprint-Sensor/), a custom domain,
// or file:// — no rebuild needed if the deploy target moves.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The tester deploys on every push to main, so the tag alone does not identify
// a build. CI exports the commit; a local checkout has git; `npm run dev`
// outside a checkout falls back to 'dev' rather than failing the build.
function buildSha() {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: { outDir: 'dist', sourcemap: true },
});
