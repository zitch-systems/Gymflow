// Public, non-mutating checks for the API surface compiled into native builds.
// No test users, messages, payments, or credentials are created by this probe.
import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? 'https://www.gymflow.ng');
if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('A clean HTTPS origin is required.');
const probes = [
  { path: '/account/delete', method: 'GET', status: 200, html: true },
  { path: '/api/app/account-deletion', method: 'GET', status: 401 },
  { path: '/api/app/profile', method: 'GET', status: 401 },
  { path: '/api/app/session', method: 'POST', status: 400, body: '{}' },
  { path: '/api/app/profile', method: 'OPTIONS', status: 204, cors: true },
];
for (const probe of probes) {
  const response = await fetch(new URL(probe.path, origin), {
    method: probe.method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    ...(probe.body ? { headers: { 'Content-Type': 'application/json' }, body: probe.body } : {}),
  });
  assert.equal(response.status, probe.status, `${probe.method} ${probe.path}`);
  if (probe.html) assert.ok((await response.text()).includes('account deletion'), 'Deletion entry page content is missing.');
  if (probe.cors) assert.match(response.headers.get('access-control-allow-headers') ?? '', /x-gym-id/i);
  console.log(`${probe.method} ${probe.path}: ${response.status}`);
}
