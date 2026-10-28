# Scoped deepmerge security patch

This is a vendored MIT-licensed build of upstream `deepmerge@4.3.1` (`dist/cjs.js`, SHA-256 `2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`). The original license and declarations are retained. It is our fork, not an upstream 4.3.2 release.

The patch addresses GHSA-gcqx-w48m-w2h4 / CVE-2026-93753: forbidden prototype keys are rejected in both the target-copy and source-copy loops; permitted properties are defined as own data properties. This covers null-prototype targets, nested null placeholders and own `__proto__` properties. All other merge behavior is retained.

References: https://github.com/advisories/GHSA-gcqx-w48m-w2h4 and https://github.com/TehShrike/deepmerge/issues/273 . Upstream 4.3.1 is still the latest registry release at review on 2026-10-28. Review future upstream releases and advisories before replacing or updating this fork; registry audits cannot assess a local fork. `test:build-security` tests the actual copy resolved by Expo, including exploit regressions and normal merge compatibility. The bundle audit rejects this build-only package in shipped app source maps.
