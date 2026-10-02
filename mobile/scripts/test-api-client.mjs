import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/api/client.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function loadClient(fetch) {
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(id) {
      if (id === 'expo-constants') return { default: { expoConfig: { extra: {} } } };
      throw new Error(`Unexpected require: ${id}`);
    },
    fetch,
    process: { env: {} },
    URL,
    AbortController,
    Error,
    Promise,
    JSON,
    Math,
    Date,
  });
  vm.runInContext(compiled, context, { filename: 'src/api/client.ts' });
  return module.exports;
}

function session(name, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  return { access_token: `access-${name}`, refresh_token: `refresh-${name}`, expires_at: expiresAt, expires_in: 3600, token_type: 'bearer' };
}

async function selectedGymHeader() {
  let seen;
  const client = loadClient(async (_url, init) => { seen = init.headers; return response(200, { ok: true }); });
  const current = session('a');
  client.bindAuth({ getSession: () => current, getGymId: () => 'gym-a', saveSession: async () => {}, onSessionLost: async () => {} });
  await client.api.get('/api/app/me');
  assert.equal(seen.Authorization, 'Bearer access-a');
  assert.equal(seen['X-Gym-Id'], 'gym-a');
}

async function concurrentRefreshIsSingleFlight() {
  let refreshes = 0;
  let current = session('old', Math.floor(Date.now() / 1000) - 10);
  const next = session('new');
  const client = loadClient(async (url) => {
    if (String(url).endsWith('/api/app/session')) {
      refreshes += 1;
      await Promise.resolve();
      return response(200, { session: next });
    }
    return response(200, { ok: true });
  });
  client.bindAuth({ getSession: () => current, getGymId: () => 'gym-a', saveSession: async (value) => { current = value; }, onSessionLost: async () => {} });
  await Promise.all([client.api.get('/api/app/me'), client.api.get('/api/app/plans')]);
  assert.equal(refreshes, 1);
  assert.equal(current.access_token, 'access-new');
}

async function refreshNetworkFailureRetainsSession() {
  const current = session('kept', Math.floor(Date.now() / 1000) - 10);
  let lost = 0;
  const client = loadClient(async (url) => {
    if (String(url).endsWith('/api/app/session')) throw new TypeError('offline');
    return response(200, {});
  });
  client.bindAuth({ getSession: () => current, getGymId: () => 'gym-a', saveSession: async () => assert.fail('must not save'), onSessionLost: async () => { lost += 1; } });
  await assert.rejects(client.api.get('/api/app/me'), (error) => error.code === 'offline');
  assert.equal(lost, 0);
}

async function stale401CannotClearNewSession() {
  let resolveOld;
  let current = session('old');
  let gym = 'gym-old';
  let lost = 0;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  const client = loadClient(async (url) => String(url).endsWith('/api/app/me') ? oldResponse : response(500, {}));
  client.bindAuth({ getSession: () => current, getGymId: () => gym, saveSession: async (value) => { current = value; }, onSessionLost: async () => { lost += 1; current = null; } });
  const request = client.api.get('/api/app/me');
  current = session('new');
  gym = 'gym-new';
  resolveOld(response(401, { error: 'expired' }));
  await assert.rejects(request, (error) => error.name === 'AbortError');
  assert.equal(lost, 0);
  assert.equal(current.access_token, 'access-new');
}

async function delayedPayloadCannotReachNewSession() {
  let resolveJson;
  let current = session('old');
  let gym = 'gym-old';
  const body = new Promise((resolve) => { resolveJson = resolve; });
  const client = loadClient(async () => ({ status: 200, ok: true, json: () => body }));
  client.bindAuth({ getSession: () => current, getGymId: () => gym, saveSession: async (value) => { current = value; }, onSessionLost: async () => {} });
  const request = client.api.get('/api/app/me');
  await Promise.resolve();
  current = session('new');
  gym = 'gym-new';
  resolveJson({ private_member_value: 'old account data' });
  await assert.rejects(request, (error) => error.name === 'AbortError');
}

async function refreshAfterSignOutCannotRestoreSession() {
  let resolveRefresh;
  let current = session('old', Math.floor(Date.now() / 1000) - 10);
  let gym = 'gym-old';
  let saves = 0;
  let lost = 0;
  const refreshResponse = new Promise((resolve) => { resolveRefresh = resolve; });
  const client = loadClient(async (url) => {
    if (String(url).endsWith('/api/app/session')) return refreshResponse;
    return response(200, { ok: true });
  });
  client.bindAuth({
    getSession: () => current,
    getGymId: () => gym,
    saveSession: async (value) => { saves += 1; current = value; },
    onSessionLost: async () => { lost += 1; current = null; },
  });
  const request = client.api.get('/api/app/me');
  await Promise.resolve();
  current = null;
  gym = null;
  resolveRefresh(response(200, { session: session('should-not-return') }));
  await assert.rejects(request, (error) => error.name === 'AbortError');
  assert.equal(saves, 0);
  assert.equal(lost, 0);
  assert.equal(current, null);
}

await selectedGymHeader();
await concurrentRefreshIsSingleFlight();
await refreshNetworkFailureRetainsSession();
await stale401CannotClearNewSession();
await delayedPayloadCannotReachNewSession();
await refreshAfterSignOutCannotRestoreSession();
console.log('API client auth, refresh race, offline retention, and gym scoping checks passed.');
