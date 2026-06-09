import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Flat config (`next lint` was removed in Next 16; `npm run lint` calls eslint
// directly). design/ holds the static HTML prototypes — not lintable app code.
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'design/**', 'public/**', 'next-env.d.ts'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Targets client-component re-render purity; this app's pages are async
      // server components that legitimately read the clock per request
      // (new Date()/Date.now() for "today"/"this week" queries).
      'react-hooks/purity': 'off',
    },
  },
];

export default config;
