import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` is a Next.js bundler sentinel — alias to a no-op so the
      // SUT can be imported under Node.
      'server-only': path.resolve(__dirname, 'tests/unit/_stub-server-only.ts'),
    },
  },
});
