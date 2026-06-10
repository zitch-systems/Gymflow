import type { MetadataRoute } from 'next';

// Web app manifest — makes the member app installable ("add to home screen",
// as the marketing pages promise). Deliberately NO service worker: public/sw.js
// is a kill-switch for an older broken worker, and installability does not
// require one. Members install from /dashboard, so that's the start URL.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GymFlow',
    short_name: 'GymFlow',
    description: 'Your gym in your pocket — check in, book classes, renew your membership.',
    id: '/dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a12',
    theme_color: '#0a0a12',
    icons: [
      { src: '/images/appicon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/images/appicon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/images/appicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
