import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // typedRoutes turned off for now — many marketing links point at routes
  // (/features, /about, /signup, /login, /contact, /careers, /legal, /gallery,
  // /dashboard, /admin) that are scheduled for follow-up sessions. Re-enable
  // once every link target has a corresponding page.tsx.
};

export default config;
