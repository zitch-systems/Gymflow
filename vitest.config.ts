import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the tsconfig `@/*` → repo-root mapping so unit tests can import app
  // lib code (e.g. `@/lib/plan-duration`) the same way the app does.
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup/global.ts'],
    setupFiles: ['test/setup/each.ts'],
    // Serial: the whole suite shares one Postgres database. Parallel workers
    // would race on the seeded fixtures. Speed isn't a concern at current
    // suite size; correctness is.
    fileParallelism: false,
    testTimeout: 15_000,
    // Keep tsc happy without pulling test files into the Next build.
    typecheck: { enabled: false },
  },
});
