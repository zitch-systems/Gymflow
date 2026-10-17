import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Drive the actual hook through renders/focus changes. The transport purposely
// ignores cancellation to reproduce responses that finish after a route change.
const source = fs.readFileSync(new URL('../src/hooks/use-resource.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness() {
  const slots = [];
  const pending = [];
  const effects = [];
  let cursor = 0;
  let focusSlot;
  const changed = (old, next) => !old || old.length !== next.length || next.some((value, i) => value !== old[i]);
  function effect(callback, deps) {
    const index = cursor++;
    const previous = slots[index];
    if (changed(previous?.deps, deps)) {
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: callback() };
      });
    }
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useEffect: effect,
  };
  class ApiError extends Error {}
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, AbortController, Date, Error,
    require(name) {
      if (name === 'react') return react;
      if (name === 'expo-router') return { useFocusEffect(callback) { focusSlot = cursor; effect(callback, [callback]); } };
      if (name === '@/api/client') return {
        ApiError,
        api: { get(path, signal) { return new Promise((resolve, reject) => pending.push({ path, signal, resolve, reject })); } },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    pending,
    render(path) {
      cursor = 0;
      const resource = module.exports.useResource(path);
      effects.splice(0).forEach((run) => run());
      return resource;
    },
    blur() { slots[focusSlot]?.cleanup?.(); },
  };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const app = harness();
let resource = app.render('/receipt/a');
assert.equal(resource.loading, true);
app.pending[0].resolve({ member: 'A' });
await tick();
resource = app.render('/receipt/a');
assert.equal(resource.data.member, 'A');
const oldSetter = resource.set;
resource = app.render('/receipt/b');
assert.equal(resource.data, null, 'old receipt is hidden immediately when its route id changes');
assert.equal(resource.loading, true);
assert.equal(resource.lastRefreshedAt, null);
app.pending[1].resolve({ member: 'B' });
await tick();
resource = app.render('/receipt/b');
assert.equal(resource.data.member, 'B');
oldSetter(() => ({ member: 'OLD MUTATION' }));
assert.equal(app.render('/receipt/b').data.member, 'B', 'old mutation callback cannot change another route');
resource.refresh();
app.blur();
assert.equal(app.pending[2].signal.aborted, true);
app.pending[2].resolve({ member: 'LATE' });
await tick();
assert.equal(app.render('/receipt/b').data.member, 'B', 'response arriving after blur is ignored');
resource = app.render('');
assert.equal(resource.data, null);
assert.equal(resource.loading, false);
console.log('Resource hook checks passed: route data isolation, stale setters, and delayed blurred-screen responses.');
