import { test, expect, expectRedirectToLogin } from './helpers';

// Protected-route guard matrix. Visiting any authenticated surface without a
// session must land on /login (the proxy/DAL redirect). Backend-light: no
// seeded data needed — an anonymous request can never pass the guard.

test.describe('member portal guards', () => {
  const memberRoutes = [
    '/dashboard',
    '/dashboard/inbox',
    '/dashboard/profile',
    '/dashboard/cards',
    '/dashboard/pt-packs',
    '/dashboard/renew',
    '/dashboard/instructors',
    '/classes',
    '/checkin',
  ];
  for (const path of memberRoutes) {
    test(`${path} → /login`, async ({ page }) => {
      await expectRedirectToLogin(page, path);
    });
  }
});

test.describe('admin portal guards', () => {
  const adminRoutes = [
    '/admin/dashboard',
    '/admin/members',
    '/admin/classes',
    '/admin/instructors',
    '/admin/analytics',
    '/admin/billing',
    '/admin/announcements',
    '/admin/pricing',
    '/admin/payouts',
    '/admin/wallet',
    '/admin/settings',
  ];
  for (const path of adminRoutes) {
    test(`${path} → /login`, async ({ page }) => {
      await expectRedirectToLogin(page, path);
    });
  }
});

test.describe('coach portal guards', () => {
  const coachRoutes = [
    '/coach',
    '/coach/clients',
    '/coach/earnings',
    '/coach/timetable',
    '/coach/profile',
    '/coach/attendance',
  ];
  for (const path of coachRoutes) {
    test(`${path} → /login`, async ({ page }) => {
      await expectRedirectToLogin(page, path);
    });
  }
});

test.describe('platform guards', () => {
  test('/superadmin → /login', async ({ page }) => {
    await expectRedirectToLogin(page, '/superadmin');
  });
  test('/instructor → /login', async ({ page }) => {
    await expectRedirectToLogin(page, '/instructor');
  });
});

test.describe('login preserves the intended destination', () => {
  test('redirect carries a ?next param back to the requested page', async ({ page }) => {
    await page.goto('/dashboard/inbox');
    await expect(page).toHaveURL(/\/login/);
    // The proxy/DAL appends ?next= so post-login can bounce the user back.
    await expect(page).toHaveURL(/next=/);
  });
});
