import { test, expect, signIn } from './helpers';

test.describe('login error cases', () => {
  test('rejects bad credentials with a friendly error', async ({ page }) => {
    await signIn(page, 'nobody-e2e@gymflow.test', 'NotARealPassword!');
    await expect(page.locator('.error-msg')).toContainText(/Invalid email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('blocks empty submission via HTML validation', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Either client-side required, or server returns error.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('protected route guards', () => {
  test('GET /admin/dashboard without session redirects to /login', async ({ page }) => {
    const res = await page.goto('/admin/dashboard');
    // After redirect chain the final URL is /login
    await expect(page).toHaveURL(/\/login/);
    expect(res?.status()).toBeLessThan(400);
  });

  test('GET /dashboard without session redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('GET /superadmin without session redirects to /login', async ({ page }) => {
    await page.goto('/superadmin');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('paystack api auth', () => {
  test('POST /api/paystack/initiate without session returns 401', async ({ request }) => {
    const res = await request.post('/api/paystack/initiate', {
      data: { email: 'x@example.com', amount: 1000 },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/paystack/verify without session returns 401', async ({ request }) => {
    const res = await request.post('/api/paystack/verify', {
      data: { reference: 'fake', gym_id: 'fake', end_date: '2026-12-31' },
    });
    expect(res.status()).toBe(401);
  });
});
