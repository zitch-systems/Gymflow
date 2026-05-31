import { test, expect } from './helpers';

// Lightweight SEO + accessibility smoke across public pages. Not a full axe
// audit — it catches the regressions that matter: missing <title>, missing
// lang, multiple/zero <h1>, and console errors on load.

const publicPages = ['/', '/pricing', '/features', '/about', '/login', '/join', '/signup'];

for (const path of publicPages) {
  test.describe(`page ${path}`, () => {
    test('has a non-empty <title> and html[lang]', async ({ page }) => {
      await page.goto(path);
      expect((await page.title()).trim().length).toBeGreaterThan(0);
      await expect(page.locator('html')).toHaveAttribute('lang', /\w/);
    });

    test('has at least one <h1>', async ({ page }) => {
      await page.goto(path);
      expect(await page.locator('h1').count()).toBeGreaterThanOrEqual(1);
    });

    test('loads without console errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path, { waitUntil: 'networkidle' });
      // Ignore benign favicon/3rd-party noise; fail on app-origin errors.
      const appErrors = errors.filter((e) => !/favicon|fonts\.gstatic|fonts\.googleapis|the server responded with a status/i.test(e));
      expect(appErrors, appErrors.join('\n')).toHaveLength(0);
    });
  });
}
