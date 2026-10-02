import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/auth-routing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: 'src/lib/auth-routing.ts' });

const { authRouteTarget } = module.exports;

assert.equal(authRouteTarget('loading', []), null, 'loading must not navigate');
assert.equal(authRouteTarget('signed-out', []), '/(auth)/gym', 'fresh signed-out launch chooses gym');
assert.equal(authRouteTarget('signed-in', []), '/(tabs)', 'restored root session opens tabs');
assert.equal(authRouteTarget('signed-in', ['index']), '/(tabs)', 'explicit root index opens tabs');
assert.equal(authRouteTarget('signed-in', ['(auth)', 'sign-in']), '/(tabs)', 'signed-in user leaves auth flow');
assert.equal(authRouteTarget('signed-out', ['(auth)', 'gym']), null, 'signed-out auth flow is preserved');
assert.equal(authRouteTarget('signed-in', ['receipt', '[id]']), null, 'signed-in protected deep link is preserved');
assert.equal(authRouteTarget('signed-in', ['pay', 'callback']), null, 'signed-in payment callback is preserved');
assert.equal(authRouteTarget('signed-out', ['pay', 'callback']), '/(auth)/gym', 'signed-out callback cannot mount privately');

console.log('Auth routing cold launch, auth flow, and protected deep-link checks passed.');
