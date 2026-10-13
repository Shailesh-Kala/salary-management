import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // The employee field rules live in the server and are shared with the form (D-057).
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, '../server/src/shared') } },
  // Same-origin in development, so the SameSite=Strict session cookie just works.
  server: { proxy: { '/api': API, '/health': API } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15_000,
    // More jsdom workers only add CPU contention (slowest test 5.5 s uncapped vs 2.2 s at 2,
    // same total time), which made async waits time out now and then.
    maxWorkers: 2,
  },
});
