import { test, expect } from './helpers';

// Public marketing + static SEO assets. No auth, no DB — pure render/contract.

test.describe('marketing pages render', () => {
  test('home: hero + pricing anchor + trial CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/GymFlow/);
    await expect(page.getByRole('heading', { name: /Run your gym/i })).toBeVisible();
    await expect(page.getByText(/₦20,000/)).toBeVisible();
    await expect(page.getByRole('link', { name: /start free trial/i }).first()).toBeVisible();
  });

  test('pricing page renders the platform fee', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/₦20,000/)).toBeVisible();
  });

  test('features page renders', async ({ page }) => {
    const res = await page.goto('/features');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('about page renders', async ({ page }) => {
    const res = await page.goto('/about');
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('signup page renders an account form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
  });

  test('unknown route returns a 404', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist-xyz');
    expect(res?.status()).toBe(404);
  });
});

test.describe('static SEO assets', () => {
  test('robots.txt is served and references the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/sitemap/i);
  });

  test('sitemap.xml is valid XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
  });

  test('opengraph-image renders', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/image\//);
  });
});
