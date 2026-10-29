import { defineConfig } from 'vitest/config';
/** Explicit private, read-only paid evaluation. Ordinary tests retain their dummy secrets. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/lib/ai/behavior-history.live.test.ts'],
    maxConcurrency: 3,
    clearMocks: true,
  },
});
