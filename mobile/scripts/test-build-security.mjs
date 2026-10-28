import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve('@expo/config/package.json'));
const merge = configRequire('deepmerge');
assert.equal(configRequire('deepmerge/package.json').name, '@gymflow/deepmerge-secure');
assert.equal(realpathSync(configRequire.resolve('deepmerge')), realpathSync(require.resolve('../vendor/deepmerge-secure/index.cjs')));

// Both copy loops and recursive merges must reject attacker-controlled keys.
const attack = JSON.parse('{"__proto__":{"gymflowPoisoned":true},"constructor":{"prototype":{"gymflowPoisoned":true}},"prototype":{"gymflowPoisoned":true},"safe":1}');
const cases = [
  merge(Object.create(null), attack),
  merge(attack, { safe: 2 }),
  merge({ nested: null }, { nested: attack }).nested,
  merge({ nested: Object.create(null) }, { nested: attack }).nested,
  merge({}, { entries: [attack] }).entries[0],
];
for (const result of cases) {
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.gymflowPoisoned, undefined);
  for (const key of ['__proto__', 'constructor', 'prototype']) assert.equal(Object.hasOwn(result, key), false);
  assert.equal(typeof result.safe, 'number');
}
assert.equal({}.gymflowPoisoned, undefined);

// Preserve the merge behavior Expo uses for app configuration and plugin props.
const symbol = Symbol('config');
const date = new Date('2026-01-01');
const regex = /gymflow/;
const left = { android: { permissions: ['CAMERA'] }, plugins: ['router'], date, regex, [symbol]: { a: 1 } };
const right = { android: { package: 'ng.gymflow.member' }, plugins: ['secure-store'], [symbol]: { b: 2 } };
const result = merge(left, right);
assert.deepEqual(result.android, { permissions: ['CAMERA'], package: 'ng.gymflow.member' });
assert.deepEqual(result.plugins, ['router', 'secure-store']);
assert.deepEqual(result[symbol], { a: 1, b: 2 });
assert.notEqual(result.android, left.android);
assert.equal(result.date, date);
assert.equal(result.regex, regex);
assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
assert.deepEqual(merge({ plugins: ['old'] }, { plugins: ['new'] }, { arrayMerge: (_a, b) => b }).plugins, ['new']);
assert.deepEqual(merge({ config: { a: 1 } }, { config: { b: 2 } }, {
  customMerge: key => key === 'config' ? (_a, b) => b : undefined,
}), { config: { b: 2 } });
const { getConfig } = configRequire('./build/Config.js');
assert.equal(getConfig(process.cwd(), { skipSDKVersionRequirement: true }).exp.android.package, 'ng.gymflow.member');

// Verify the actual copy used by Expo's certificate tooling, including the
// malformed nested DigestAlgorithmIdentifier rejected by the RSA patch.
const expoRequire = createRequire(require.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const certRequire = createRequire(cliRequire.resolve('@expo/code-signing-certificates/package.json'));
const forge = certRequire('node-forge');
assert.equal(certRequire('node-forge/package.json').version, '1.4.2');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = forge.pki.privateKeyFromPem(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
const publicKey = forge.pki.publicKeyFromPem(pair.publicKey.export({ type: 'spki', format: 'pem' }).toString());
const md = forge.md.sha256.create().update('GymFlow security regression');
const hash = md.digest().getBytes();
assert.equal(publicKey.verify(hash, privateKey.sign(md)), true);
assert.equal(publicKey.verify(forge.md.sha256.create().update('different').digest().getBytes(), privateKey.sign(md)), false);
const { asn1 } = forge;
const primitive = (type, value) => asn1.create(asn1.Class.UNIVERSAL, type, false, value);
const sequence = values => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, values);
const badDigestInfo = sequence([
  sequence([
    primitive(asn1.Type.OID, asn1.oidToDer(forge.pki.oids.sha256).getBytes()),
    primitive(asn1.Type.NULL, ''),
    primitive(asn1.Type.OCTETSTRING, 'unexpected nested child'),
  ]),
  primitive(asn1.Type.OCTETSTRING, hash),
]);
const malformedSignature = privateKey.sign(asn1.toDer(badDigestInfo).getBytes(), 'NONE');
assert.throws(() => publicKey.verify(hash, malformedSignature), /DigestInfo/);
console.log('Expo config compatibility, deepmerge poisoning regressions and RSA malformed-signature rejection passed.');
