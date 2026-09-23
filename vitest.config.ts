import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/contract/**/*.spec.ts', 'test/live/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**', 'test/integration/**', 'test/e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    },
  },
});
