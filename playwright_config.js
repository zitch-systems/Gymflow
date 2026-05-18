// playwright.config.js
// Configure once; tests live in /tests/
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],

  // Auto-start a local server before tests (Cloudflare Wrangler if available,
  // otherwise plain Python). Override with --skip-server or set WEB_SERVER_OFF=1.
  webServer: process.env.WEB_SERVER_OFF ? undefined : {
    command: process.env.WEB_SERVER_CMD || 'npx wrangler pages dev . --port=8788 --compatibility-date=2025-01-01',
    url: process.env.BASE_URL || 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
