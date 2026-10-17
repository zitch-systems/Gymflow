import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/app/waiver.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const slots = [];
let cursor = 0;
let calls = [];
let refreshes = 0;
let handler;
let data = {
  gym: { id: 'gym-iron', name: 'Iron Gym' },
  document: { id: 'waiver-id', title: 'Read this waiver', content: 'The exact terms\nSecond paragraph', version: '2', revision: 'revision-a' },
  accepted: false, signedAt: null,
};
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
const react = {
  useState(initial) {
    const i = cursor++;
    if (!slots[i]) slots[i] = { value: initial };
    return [slots[i].value, (value) => { slots[i].value = value; }];
  },
  useRef(initial) {
    const i = cursor++;
    if (!slots[i]) slots[i] = { current: initial };
    return slots[i];
  },
};
const module = { exports: {} };
vm.runInNewContext(compiled, {
  module, exports: module.exports, Error,
  require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Linking: { openURL: async () => {} }, Pressable: 'Pressable', View: 'View' };
    if (name === 'expo-router') return { useRouter: () => ({ canGoBack: () => false, replace: () => {}, back: () => {} }) };
    if (name === '@expo/vector-icons/Ionicons') return { default: 'Icon' };
    if (name === '@/components/screen') return { Screen: 'Screen' };
    if (name === '@/components/ui') return { ...Object.fromEntries(['Badge', 'Body', 'Button', 'Card', 'ErrorState', 'Loading', 'Notice', 'StaleDataNotice', 'Title'].map((key) => [key, key])), c: {} };
    if (name === '@/hooks/use-resource') return { useResource: () => ({
      data, loading: false, refreshing: false, stale: false, error: null,
      set: (updater) => { data = updater(data); }, refresh: () => { refreshes += 1; },
    }) };
    if (name === '@/api/client') return { ApiError, API_BASE_URL: 'https://www.gymflow.ng', api: {
      post: async (path, body) => { calls.push({ path, body }); return handler ? handler() : { ...data, accepted: true, signedAt: '2026-10-17' }; },
    } };
    if (name === '@/lib/format') return { shortDate: (value) => value };
    if (name === '@/theme') return { space: {} };
    throw new Error(`Unexpected import ${name}`);
  },
});
function render() { cursor = 0; return module.exports.default(); }
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  const children = Array.isArray(tree) ? tree : [tree.props?.children];
  for (const child of children) { const match = find(child, predicate); if (match) return match; }
  return null;
}
const button = (tree) => find(tree, (n) => n.type === 'Button' && n.props.label === 'Accept waiver');
const checkbox = (tree) => find(tree, (n) => n.type === 'Pressable');
let tree = render();
assert.equal(button(tree).props.disabled, true, 'no acceptance without confirmation');
assert.ok(find(tree, (n) => n.type === 'Body' && n.props.children === data.document.content), 'render the exact current waiver text');
await button(tree).props.onPress();
assert.equal(calls.length, 0, 'a disabled-control handler also enforces consent');
checkbox(tree).props.onPress();
tree = render();
assert.equal(button(tree).props.disabled, false);
// A gym publishing a revision invalidates consent to the previous text.
data = { ...data, document: { ...data.document, revision: 'revision-b' } };
tree = render();
assert.equal(checkbox(tree).props.accessibilityState.checked, false);
assert.equal(button(tree).props.disabled, true);
checkbox(tree).props.onPress();
tree = render();
let resolve;
handler = () => new Promise((done) => { resolve = done; });
const submission = button(tree).props.onPress();
await button(tree).props.onPress();
assert.equal(calls.length, 1, 'repeat taps cannot submit multiple acceptances');
assert.equal(calls[0].path, '/api/app/waiver');
assert.equal(calls[0].body.gymId, 'gym-iron');
assert.equal(calls[0].body.revision, 'revision-b');
assert.equal(calls[0].body.accepted, true);
resolve({ ...data, accepted: true, signedAt: '2026-10-17' });
await submission;
assert.equal(button(render()), null, 'server-confirmed acceptance hides the signature action');
// A concurrent publication returns 409; show the error and reload the new text.
data = { ...data, accepted: false, document: { ...data.document, revision: 'revision-c' } };
tree = render();
checkbox(tree).props.onPress();
tree = render();
handler = async () => { throw new ApiError('Waiver changed. Read it again.', 409); };
await button(tree).props.onPress();
assert.equal(refreshes, 1);
assert.equal(button(render()).props.disabled, true);
console.log('Waiver screen checks passed: exact content, explicit consent, revision changes, duplicate taps and server-confirmed acceptance.');
