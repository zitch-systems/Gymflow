import { validateProductionEnvironment } from './release-audit.mjs';

// Hosted production builds can access Vercel's protected values. Local pulls
// contain [SENSITIVE] placeholders and cannot certify or build those values.
if (process.env.VERCEL_ENV === 'production' || process.env.GYMFLOW_PRODUCTION_RELEASE === '1') {
  const snapshot = validateProductionEnvironment(process.env);
  if (snapshot.errors.length) {
    console.error(`Production build environment invalid: ${snapshot.errors.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('Production build environment validation passed (values withheld)');
  }
}
