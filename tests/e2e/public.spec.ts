import { test, expect } from './helpers';

test.describe('public pages', () => {
  test('marketing home renders hero + pricing CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/GymFlow/);
    await expect(page.getByRole('heading', { name: /Run your gym/i })).toBeVisible();
    // Price floor — currently ₦13,999/mo. Regex allows future raises without
    // breaking this test as long as the entry plan stays in the ₦13–19k band.
    await expect(page.getByText(/₦1[3-9],\d{3}/).first()).toBeVisible();
    // CTA copy — "Launch your gym" (post design refresh, replaces the older
    // "Start free trial" wording).
    await expect(page.getByRole('link', { name: /Launch your gym/i }).first()).toBeVisible();
  });

  test('login page renders branded form', async ({ page }) => {
    await page.goto('/login');
    // Label is "Email" (singular) on the OPay-style auth form.
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    // The signup tab is labelled "Create gym" not "Create account".
    await expect(page.getByRole('link', { name: /create gym/i })).toBeVisible();
  });

  test('join page renders full form including emergency contact', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('input[name="full_name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="nok_name"]')).toBeVisible();
    await expect(page.locator('select[name="nok_relationship"]')).toBeVisible();
    await expect(page.locator('input[name="waiver_signed"]')).toBeVisible();
  });

  test('offline page is reachable', async ({ page }) => {
    const res = await page.goto('/offline');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /You're offline/i })).toBeVisible();
  });

  test('PWA manifest is valid JSON with expected fields', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.name).toContain('GymFlow');
    expect(data.start_url).toBe('/');
    expect(Array.isArray(data.icons)).toBe(true);
    expect(data.icons.length).toBeGreaterThan(0);
  });

  test('service worker file is served', async ({ request }) => {
    const res = await request.get('/sw.js');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('gymflow-v');
  });
});
