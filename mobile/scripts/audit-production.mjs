import { spawnSync } from 'node:child_process';

// These are the only advisories left in Expo SDK 57 / React Native 0.86's
// locked production graph. Both affected leaf packages are reached through
// Expo/Metro build tooling and have no patched npm release yet (braces 3.0.3
// and node-forge 1.4.0). The Android bundle audit separately proves they are
// absent from the shipped JavaScript bundle.
// Keep this narrow: a new advisory, package chain, or critical severity must
// fail CI even though npm exits non-zero for the explicitly reviewed findings.
const reviewedPackages = new Map([
  ['@expo/cli', 'high'],
  ['@expo/code-signing-certificates', 'high'],
  ['@expo/metro', 'high'],
  ['@expo/metro-config', 'high'],
  ['@expo/metro-file-map', 'high'],
  ['@react-native/community-cli-plugin', 'high'],
  ['@react-native/metro-config', 'high'],
  ['@react-native/virtualized-lists', 'high'],
  ['braces', 'high'],
  ['expo', 'high'],
  ['metro', 'high'],
  ['metro-config', 'high'],
  ['metro-file-map', 'high'],
  ['metro-transform-worker', 'high'],
  ['micromatch', 'high'],
  ['node-forge', 'high'],
  ['react-native', 'high'],
  ['react-native-reanimated', 'high'],
  ['react-native-worklets', 'high'],
]);

const reviewedDirectAdvisories = new Set([
  'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
]);

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

let audit;
try {
  audit = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr);
  console.error('npm audit did not return valid JSON.');
  process.exit(1);
}

if (!audit.metadata?.vulnerabilities || !audit.vulnerabilities) {
  process.stderr.write(result.stderr);
  console.error(audit.error?.summary ?? 'npm audit returned an incomplete result.');
  process.exit(1);
}

const vulnerabilities = audit.metadata.vulnerabilities;
const findings = audit.vulnerabilities;
const unexpected = [];

if ((vulnerabilities.critical ?? 0) !== 0) {
  unexpected.push(`${vulnerabilities.critical} critical finding(s)`);
}

for (const [name, finding] of Object.entries(findings)) {
  const expectedSeverity = reviewedPackages.get(name);
  if (expectedSeverity !== finding.severity) {
    unexpected.push(`${name} (${finding.severity}; expected ${expectedSeverity ?? 'no finding'})`);
  }

  for (const cause of finding.via) {
    if (typeof cause !== 'string' && !reviewedDirectAdvisories.has(cause.url)) {
      unexpected.push(`${name} via unreviewed advisory ${cause.url}`);
    }
  }
}

if (unexpected.length > 0) {
  console.error('Unreviewed production dependency audit result:');
  for (const item of unexpected) console.error(`- ${item}`);
  process.exit(1);
}

console.log(
  `UNRESOLVED reviewed production audit: ${vulnerabilities.high ?? 0} high, ` +
    `${vulnerabilities.moderate ?? 0} moderate, 0 critical across ` +
    `${Object.keys(findings).length} package-chain findings.`,
);
