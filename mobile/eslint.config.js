// Flat config for the React Native member app. The repo root's eslint.config.mjs
// ignores mobile/ — Next.js rules (next/image, server components) mean nothing
// here, and Expo ships the rule set that does.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'node_modules/*'] },
]);
