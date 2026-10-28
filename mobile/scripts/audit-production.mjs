import { spawnSync } from 'node:child_process';

// Registry advisories cannot evaluate the local fork's source: its exploit and
// Expo compatibility checks run in test:build-security. No audit exceptions.
const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8', shell: process.platform === 'win32',
});
let audit;
try { audit = JSON.parse(result.stdout); } catch {
  console.error('npm audit did not return valid JSON.');
  process.exit(1);
}
if (result.error || !audit.metadata?.vulnerabilities || !audit.vulnerabilities) {
  console.error('npm audit did not complete.');
  process.exit(1);
}
if (result.status !== 0 || audit.metadata.vulnerabilities.total !== 0 || Object.keys(audit.vulnerabilities).length) {
  console.error('Production dependency audit failed:', audit.metadata.vulnerabilities);
  process.exit(1);
}
console.log('Production registry audit: 0 known vulnerabilities; no exceptions.');
