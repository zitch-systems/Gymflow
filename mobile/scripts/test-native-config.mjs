import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8')).expo;
const eas = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));
const expectedApi = 'https://www.gymflow.ng';

assert.equal(app.android.package, 'ng.gymflow.member');
assert.equal(app.ios.bundleIdentifier, 'ng.gymflow.member');
assert.equal(app.scheme, 'gymflow');
assert.equal(app.extra.apiBaseUrl, expectedApi);
assert.equal(app.ios.config.usesNonExemptEncryption, false);
assert.deepEqual(app.android.permissions, ['android.permission.CAMERA']);
assert.ok(app.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));

for (const profile of ['development', 'preview', 'simulator', 'production']) {
  assert.equal(eas.build[profile].env.EXPO_PUBLIC_API_URL, expectedApi, `${profile} API URL`);
}
assert.equal(eas.build.preview.android.buildType, 'apk');
assert.equal(eas.build.preview.ios.simulator, true);
assert.equal(eas.build.simulator.ios.simulator, true);
assert.equal(eas.build.production.android.buildType, 'app-bundle');

console.log('Native identifiers, permissions, profiles, and API URL verified.');
