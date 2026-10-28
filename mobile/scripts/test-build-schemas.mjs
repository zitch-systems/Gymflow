// Exercise Expo's actual schemas after its Node-only Zod security update.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const { PluginSchema, DevToolsPluginOutputSchema } = cliRequire('./build/src/start/server/DevToolsPlugin.schema.js');
const { createMCPDevToolsExtensionSchema } = cliRequire('./build/src/start/server/createMCPDevToolsExtensionSchema.js');
const plugin = PluginSchema.parse({ packageName: 'test-plugin', packageRoot: '/test', cliExtensions: {
  description: 'Test', entryPoint: 'index.js', commands: [{ name: 'inspect', title: 'Inspect', environments: ['cli', 'mcp'], parameters: [{ name: 'count', type: 'number' }] }],
} });
const schema = createMCPDevToolsExtensionSchema(plugin);
assert.equal(schema.safeParse({ command: 'inspect', count: 1 }).success, true);
assert.equal(schema.safeParse({ command: 'inspect', count: 'wrong' }).success, false);
assert.equal(schema.safeParse({ command: 'missing' }).success, false);
assert.equal(schema.safeParse({ command: 'inspect', extra: true }).success, false);
assert.equal(PluginSchema.safeParse({ packageName: '' }).success, false);
assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 'ok', level: 'info' }]).success, true);
assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 42 }]).success, false);
console.log('Expo plugin and command schemas work with the patched Node-only Zod dependency.');
