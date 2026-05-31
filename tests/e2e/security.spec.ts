import { test, expect } from './helpers';

// Backend-light security surface: every privileged endpoint must reject an
// unauthenticated / unsigned caller BEFORE doing any real work. These run
// without a seeded DB and without a browser (APIRequestContext only). Status
// codes were confirmed against the running production build.

test.describe('API — money/platform routes never succeed for an anonymous caller', () => {
  // With an empty body these reject at validation (400); with a valid-looking
  // body they reject at the auth gate (401). Either way an anonymous caller
  // must get a 4xx and never a 2xx — that's the invariant worth locking.
  const routes = [
    '/api/paystack/initiate',
    '/api/paystack/verify',
    '/api/paystack/verify-pt-pack',
    '/api/paystack/verify-instructor',
    '/api/platform/onboard-gym',
    '/api/platform/renew-now',
  ];
  for (const path of routes) {
    test(`POST ${path} is rejected, never accepted`, async ({ request }) => {
      const res = await request.post(path, { data: {} });
      // The invariant: an anonymous/empty request is never ACCEPTED (2xx).
      // We assert >= 400 rather than a tight 4xx band so a transient upstream
      // 5xx (flaky backend) doesn't mask the security check we care about.
      expect(res.status(), `${path} returned ${res.status()}`).toBeGreaterThanOrEqual(400);
    });
  }
});

test.describe('API — paystack initiate enforces the auth gate', () => {
  // With a well-formed body the rejection is the 401 auth gate — unless the
  // IP-keyed rate limiter trips first (429) under rapid test traffic. Both are
  // "not authenticated, not accepted".
  test('POST /api/paystack/initiate with a valid body → 401 (or 429 rate-limited)', async ({ request }) => {
    const res = await request.post('/api/paystack/initiate', { data: { email: 'x@example.com', amount: 1000 } });
    expect([401, 429]).toContain(res.status());
  });
});

test.describe('Push subscription requires a session', () => {
  test('POST /api/push/subscribe → 401', async ({ request }) => {
    const res = await request.post('/api/push/subscribe', { data: {} });
    expect(res.status()).toBe(401);
  });
  test('DELETE /api/push/subscribe → 401', async ({ request }) => {
    const res = await request.delete('/api/push/subscribe', { data: { endpoint: 'x' } });
    expect(res.status()).toBe(401);
  });
});

test.describe('Webhook rejects unsigned payloads', () => {
  test('POST /api/paystack/webhook without signature → 400', async ({ request }) => {
    const res = await request.post('/api/paystack/webhook', {
      data: { event: 'charge.success', data: { reference: 'fake' } },
    });
    // Missing signature is rejected before the HMAC is even computed, so this
    // holds regardless of whether PAYSTACK_SECRET_KEY is configured.
    expect(res.status()).toBe(400);
  });

  test('POST /api/paystack/webhook with a bogus signature is never accepted', async ({ request }) => {
    const res = await request.post('/api/paystack/webhook', {
      headers: { 'x-paystack-signature': 'deadbeef' },
      data: { event: 'charge.success', data: { reference: 'fake' } },
    });
    // With a configured secret, an HMAC mismatch is rejected at the gate (401
    // on length-mismatch / bad digest). If the secret isn't configured in the
    // environment, paystackSecretKey() throws first and the route 500s before
    // the signature check — still "not accepted", just for an env reason, so
    // accept that here rather than asserting a false app regression.
    expect(res.status(), `unexpected ${res.status()}`).toBeGreaterThanOrEqual(400);
    expect(res.status()).not.toBe(200);
  });
});

test.describe('Cron routes require the shared secret', () => {
  const cronRoutes = [
    '/api/cron/auto-debit',
    '/api/cron/auto-debit-instructors',
    '/api/cron/platform-renewals',
    '/api/cron/expiry-reminders',
    '/api/cron/class-reminders',
  ];
  for (const path of cronRoutes) {
    test(`GET ${path} without bearer → 401`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(401);
    });
    test(`GET ${path} with wrong bearer → 401`, async ({ request }) => {
      expect((await request.get(path, { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
    });
  }
});
