import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.spec.ts',
      'test/contract/**/*.spec.ts',
      'test/e2e/**/*.spec.ts',
      'test/live/**/*.spec.ts',
      'test/integration/weatherapi-client.integration.spec.ts',
    ],
    exclude: ['node_modules/**', 'dist/**', 'test/integration/redis-*.integration.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/entrypoints/**',
        'src/infrastructure/cache/redis-cache.store.ts',
        'src/infrastructure/quota/redis-provider-quota.ts',
      ],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 80,
        'src/rules/**': {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },
});
