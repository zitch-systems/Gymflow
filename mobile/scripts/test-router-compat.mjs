import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRoot = join(mobileRoot, 'vendor/query-string-compat/upstream');
const upstreamHashes = {
  'base.js': '4fe40676faa0c35aa6f505d1b978fbf847a055059275a6f6ff335c8954abcf7e',
  'base.d.ts': 'a5d4d717669b02251bd646beb5d4b067130baa179a9f2e0eb1b190f8a7f783bb',
  'index.js': '8415e586a8d05e147db1408009607aa99ad0d6b01ab8a974d071ba7f086cff98',
  'index.d.ts': 'cfe2c5dd621bc76163cfa2dcb7c529c4764e0ea9adb1e1c8e42daf9f798df1c4',
  license: '5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3',
};

for (const [file, expected] of Object.entries(upstreamHashes)) {
  const actual = createHash('sha256').update(readFileSync(join(upstreamRoot, file))).digest('hex');
  assert.equal(actual, expected, `${file} differs from the reviewed query-string 9.5.1 source`);
}

// Resolve from Expo Router so this exercises its overridden dependency rather
// than an unrelated application import.
const mobileRequire = createRequire(import.meta.url);
const routerRequire = createRequire(mobileRequire.resolve('expo-router/package.json'));
const queryString = routerRequire('query-string');
for (const name of ['parse', 'stringify', 'parseUrl', 'stringifyUrl', 'pick', 'exclude']) {
  assert.equal(typeof queryString[name], 'function', `query-string.${name} must be a named export`);
}

const { getPathFromState } = routerRequire('./build/react-navigation/core/getPathFromState.js');
const { getStateFromPath } = routerRequire('./build/react-navigation/core/getStateFromPath.js');
const config = { screens: { Profile: { path: 'profile', parse: { count: Number } } } };
const path = getPathFromState({ routes: [{ name: 'Profile', params: { q: 'x y', count: 2 } }] }, config);
assert.equal(path, '/profile?q=x%20y&count=2');

const state = getStateFromPath(path, config);
assert.equal(state?.routes[0]?.name, 'Profile');
assert.deepEqual(state?.routes[0]?.params, { count: 2, q: 'x y' });

// Exercise the formerly vulnerable decoder through Router's real deep-link
// parser. The patched decoder must tolerate malformed percent encoding.
const malformed = getStateFromPath('/profile?payload=%E0%A4%A', config);
assert.equal(malformed?.routes[0]?.name, 'Profile');
assert.equal(typeof malformed?.routes[0]?.params?.payload, 'string');

console.log('Expo Router parse/stringify compatibility and vendored provenance verified.');
