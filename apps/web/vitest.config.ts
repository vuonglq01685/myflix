import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      pino: 'pino/browser',
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
    environment: 'node',
  },
});
