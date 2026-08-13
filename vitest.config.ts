import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the tsconfig `@/*` → repo-root mapping so unit tests can import app
  // lib code (e.g. `@/lib/plan-duration`) the same way the app does.
  //
  // `server-only` is stubbed out. Its whole job is to throw when a module is
  // pulled into a CLIENT bundle, and that is enforced by the Next.js bundler,
  // which vitest is not — so in tests it does nothing but block importing
  // genuinely server-side modules that are worth unit-testing (the Flow
  // encryption and the secret box, both pure crypto with no I/O). Stubbing it
  // here does not weaken the real guard in the app build.
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'server-only': resolve(__dirname, 'test/setup/server-only-stub.ts'),
    },
  },
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
