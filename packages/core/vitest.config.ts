import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { branches: 100 },
    },
  },
});
