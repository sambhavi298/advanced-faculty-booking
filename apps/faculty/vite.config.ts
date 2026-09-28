import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The portal calls the API at the same-origin path /api; the dev and preview servers forward it to
 * the API (default http://localhost:4000, override with API_URL). The browser therefore never makes
 * a cross-origin request, and `npm run dev -- --host` exposes the portal to phones on the same Wi-Fi.
 */
const api = { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true, proxy: api },
  preview: { port: 5174, strictPort: true, proxy: api },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
      thresholds: { statements: 100, functions: 100, lines: 100, branches: 90 },
    },
  },
});
