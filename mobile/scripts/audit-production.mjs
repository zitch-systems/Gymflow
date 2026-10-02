import { spawnSync } from 'node:child_process';

// These are the only advisories left in Expo SDK 57's locked production graph.
// Keep this narrow: a new advisory, package chain, or critical severity must
// fail CI even though npm exits non-zero for the explicitly reviewed findings.
const reviewedPackages = new Map([
  ['@expo/cli', 'high'],
  ['@expo/code-signing-certificates', 'high'],
  ['expo', 'high'],
  ['node-forge', 'high'],
]);

const reviewedDirectAdvisories = new Set([
  'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
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
  `Reviewed residual production audit: ${vulnerabilities.high ?? 0} high, ` +
    `${vulnerabilities.moderate ?? 0} moderate, 0 critical across ` +
    `${Object.keys(findings).length} package-chain findings.`,
);
