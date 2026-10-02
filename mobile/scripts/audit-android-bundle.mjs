import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const exportDirectory = resolve(process.argv[2] ?? 'dist-ci');
const maps = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (extname(entry.name) === '.map') maps.push(path);
  }
}

collect(exportDirectory);
if (maps.length === 0) {
  console.error(`No source maps found under ${exportDirectory}; export with --source-maps.`);
  process.exit(1);
}

const excludedBuildPackages = [
  '/node_modules/@expo/code-signing-certificates/',
  '/node_modules/image-size/',
  '/node_modules/node-forge/',
  '/node_modules/xcode/',
];
const allowedExpoCliSource =
  '/node_modules/expo/node_modules/@expo/cli/build/metro-require/require.js';
const forbiddenLegacyRouterSources = [
  '/node_modules/expo-router/node_modules/query-string/',
  '/node_modules/expo-router/node_modules/decode-uri-component/',
];
const requiredPatchedSources = new Map([
  ['query-string compatibility adapter', '/vendor/query-string-compat/index.js'],
  ['query-string 9.5.1 implementation', '/vendor/query-string-compat/upstream/base.js'],
  ['decode-uri-component 0.5.0 implementation', '/node_modules/decode-uri-component/index.js'],
]);
const seenPatchedSources = new Set();
const matches = [];

for (const mapPath of maps) {
  const sourceMap = JSON.parse(readFileSync(mapPath, 'utf8'));
  for (const source of sourceMap.sources ?? []) {
    const normalized = `/${source.replaceAll('\\', '/')}`;
    const unexpectedExpoCliSource = normalized.includes('/node_modules/@expo/cli/')
      && !normalized.endsWith(allowedExpoCliSource);
    for (const [label, suffix] of requiredPatchedSources) {
      if (normalized.endsWith(suffix)) seenPatchedSources.add(label);
    }
    if (
      unexpectedExpoCliSource
      || forbiddenLegacyRouterSources.some((segment) => normalized.includes(segment))
      || excludedBuildPackages.some((segment) => normalized.includes(segment))
    ) {
      matches.push(`${mapPath}: ${source}`);
    }
  }
}

if (matches.length > 0) {
  console.error('Node-only Expo build packages unexpectedly reached the Android bundle:');
  for (const match of matches) console.error(`- ${match}`);
  process.exit(1);
}

const missingPatchedSources = [...requiredPatchedSources.keys()]
  .filter((label) => !seenPatchedSources.has(label));
if (missingPatchedSources.length > 0) {
  console.error('Patched Router query sources are missing from the Android bundle:');
  for (const label of missingPatchedSources) console.error(`- ${label}`);
  process.exit(1);
}

console.log(
  `Checked ${maps.length} Android source map(s); patched Router query sources are present and reviewed vulnerable or Node-only sources are absent.`,
);
