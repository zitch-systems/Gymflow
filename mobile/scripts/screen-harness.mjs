// Executes real screen components and handlers with isolated native/network boundaries.
// This is interaction coverage, not a device renderer or a visual test.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../src/', import.meta.url));
export class ApiError extends Error { constructor(message, status = 422, code = null) { super(message); this.status = status; this.code = code; } }
export function harness(route, initial, options = {}) {
  const state = { data: structuredClone(initial), loading: false, error: null, stale: false, offline: false, refreshing: false, lastRefreshedAt: null, ...options.resource };
  const calls = [], navigation = [], alerts = [], links = [], effects = [], store = new Map(), modules = new Map();
  let cursor = 0, owner, refreshes = 0, tree;
  const params = { code: 'TEST01', gymName: 'Test Gym', gymSlug: 'test', id: 'receipt', ...options.params };
  const auth = { status: 'signed-in', gym: { id: 'gym', slug: 'test' }, signIn: async () => {}, signUp: async () => {}, signOut: async () => {}, resolveGym: async () => ({ name: 'Test Gym', slug: 'test' }), ...options.auth };
  const slot = (init) => { const list = store.get(owner) || []; store.set(owner, list); const i = cursor++; if (!(i in list)) list[i] = init(); return list[i]; };
  const react = {
    useState: (initialValue) => { const s = slot(() => ({ value: typeof initialValue === 'function' ? initialValue() : initialValue })); return [s.value, (value) => { s.value = typeof value === 'function' ? value(s.value) : value; }]; },
    useRef: (initialValue) => slot(() => ({ current: initialValue })),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useEffect: (fn, deps) => { const s = slot(() => ({})); if (!s.deps || deps?.some((v, i) => v !== s.deps[i])) { effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); s.deps = deps; } },
  };
  const node = (type, props) => ({ type, props });
  const nativeNames = ['View','Pressable','Text','TextInput','ScrollView','Modal','Switch','ActivityIndicator'];
  const native = { ...Object.fromEntries(nativeNames.map(n => [n, n])), StyleSheet: { create: v => v, hairlineWidth: 1, absoluteFill: {} },
    Alert: { alert: (...args) => alerts.push(args) }, Linking: { openURL: async url => { links.push(url); }, openSettings: async () => links.push('settings') }, Share: { share: async value => { calls.push({ method: 'share', body: value }); } } };
  const router = { push: value => navigation.push(['push', value]), replace: value => navigation.push(['replace', value]), back: () => navigation.push(['back']), canGoBack: () => true };
  const api = Object.fromEntries(['get','post','patch'].map(method => [method, async (url, body) => { calls.push({ method, url, body }); return options.api ? options.api(method, url, body) : { ok: true }; }]));
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    function require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: node, jsxs: node, Fragment: 'Fragment' };
      if (name === 'react-native') return native;
      if (name === 'expo-router') return { useRouter: () => router, useLocalSearchParams: () => params, useSegments: () => ['(tabs)'], useRootNavigationState: () => ({ key: 'ready' }), Stack: Object.assign('Stack', { Screen: 'Stack.Screen' }), Tabs: Object.assign('Tabs', { Screen: 'Tabs.Screen' }) };
      if (name === 'expo-router/react-navigation') return { useIsFocused: () => true };
      if (name === 'expo-camera') return { CameraView: 'CameraView', useCameraPermissions: () => [options.permission || { granted: false, canAskAgain: false }, async () => ({ granted: false })] };
      if (name === 'expo-clipboard') return { setStringAsync: async value => calls.push({ method: 'copy', body: value }) };
      if (name === 'expo-web-browser') return { openAuthSessionAsync: async (url, returnUrl) => { calls.push({ method: 'checkout', url, returnUrl }); return options.checkout || { type: 'cancel' }; } };
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name === 'expo-splash-screen') return { preventAutoHideAsync: async () => {}, hideAsync: async () => {} };
      if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', useSafeAreaInsets: () => ({ bottom: 20 }) };
      if (name === '@expo/vector-icons/Ionicons') return { default: 'Icon' };
      if (name === '@/auth/context') return { useAuth: () => auth, AuthProvider: 'AuthProvider' };
      if (name === '@/auth/storage') return { storage: { getLastCode: async () => '' } };
      if (name === '@/api/client') return { api, ApiError, API_BASE_URL: 'https://www.gymflow.ng' };
      if (name === '@/components/screen') return { Screen: 'Screen' };
      if (name === '@/components/ui') return new Proxy({ c: {} }, { get: (o, p) => p in o ? o[p] : p });
      if (name === '@/hooks/use-resource') return { useResource: () => ({ ...state, refresh: () => { refreshes++; }, set: fn => { if (state.data) state.data = fn(state.data); } }) };
      if (name.startsWith('@/lib/') || name === '@/theme') return load(path.join(root, name.slice(2) + '.ts'));
      throw new Error(`Unmocked native boundary: ${name}`);
    }
    vm.runInNewContext(compiled, { module, exports: module.exports, require, URL, Error, Date, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} }, { filename: file });
    modules.set(file, module.exports); return module.exports;
  }
  const component = load(path.join(root, 'app', route)).default;
  function expand(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(expand);
    if (typeof value.type === 'function') { owner = value.type; cursor = 0; return expand(value.type(value.props)); }
    return { ...value, props: Object.fromEntries(Object.entries(value.props || {}).map(([k,v]) => [k, (k === 'children' || k === 'footer' || k === 'action' || k === 'right') ? expand(v) : v])) };
  }
  const h = { state, calls, navigation, alerts, links, params, auth,
    render() { owner = component; cursor = 0; tree = expand(component()); while(effects.length) effects.shift()(); return tree; },
    nodes(predicate) { const found = []; const walk = value => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(walk); if (predicate(value)) found.push(value); for (const [key,v] of Object.entries(value.props || {})) if (['children','footer','action','right'].includes(key)) walk(v); }; walk(tree); return found; },
    button(label) { return h.nodes(n => n.type === 'Button' && n.props.label === label)[0]; },
    field(label) { return h.nodes(n => n.type === 'Field' && n.props.label === label)[0]; },
    row(title) { return h.nodes(n => n.type === 'Row' && n.props.title === title)[0]; },
    get refreshes() { return refreshes; },
    dispose() { for (const slots of store.values()) for (const s of slots) s.cleanup?.(); },
  };
  return h;
}
