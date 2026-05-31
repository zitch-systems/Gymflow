import { test, expect } from './helpers';

test.describe('public pages', () => {
  test('marketing home renders hero + pricing CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/GymFlow.*Nigerian Fitness Businesses/);
    await expect(page.getByRole('heading', { name: /Run your gym/i })).toBeVisible();
    await expect(page.getByText(/₦20,000/)).toBeVisible();
    await expect(page.getByRole('link', { name: /start free trial/i }).first()).toBeVisible();
  });

  test('login page renders branded form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /create account/i })).toBeVisible();
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
