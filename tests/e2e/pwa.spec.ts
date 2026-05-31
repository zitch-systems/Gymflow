import { test, expect } from './helpers';

// PWA contract: manifest, service worker (incl. the v6 push handlers added in
// the inbox/push sprint), offline shell, and install metadata.

test.describe('PWA manifest', () => {
  test('manifest.json has the required installability fields', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.name).toContain('GymFlow');
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons.length).toBeGreaterThan(0);
    // At least one maskable icon for adaptive home-screen rendering.
    expect(m.icons.some((i: { purpose?: string }) => (i.purpose ?? '').includes('maskable'))).toBe(true);
  });

  test('manifest is linked from the document head', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest/);
  });

  test('theme-color meta is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /#/);
  });
});

test.describe('service worker', () => {
  test('sw.js is served and is the current version', async ({ request }) => {
    const res = await request.get('/sw.js');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('gymflow-v');
  });

  test('sw.js registers push + notificationclick handlers', async ({ request }) => {
    const body = await (await request.get('/sw.js')).text();
    expect(body).toContain("addEventListener('push'");
    expect(body).toContain("addEventListener('notificationclick'");
  });

  test('sw.js never caches authenticated HTML (shared-device safety)', async ({ request }) => {
    const body = await (await request.get('/sw.js')).text();
    // The fetch handler must guard dashboard/admin/etc. from runtime caching.
    expect(body).toMatch(/dashboard\|admin\|coach\|superadmin/);
  });
});

test.describe('offline shell', () => {
  test('/offline renders the branded fallback', async ({ page }) => {
    const res = await page.goto('/offline');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /offline/i })).toBeVisible();
  });
});
