import type { MetadataRoute } from 'next';

// Web app manifest — makes the member app installable ("add to home screen",
// as the marketing pages promise). The active service worker lives in
// public/sw.js and is registered by components/pwa-register.tsx.
// Members install from /dashboard, so that's the start URL.
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
    // Emerald per the Flowbell brand sheet (LOGO-ROLLOUT §5) — the installed
    // app's toolbar carries the brand; the splash stays on the dark surface.
    theme_color: '#11d18b',
    // Both icons are the Flowbell squircle (near-black tile, emerald mark), so
    // each serves as `any` and `maskable` — no white box behind the mark.
    // Listed as separate entries because Next's Manifest type takes one purpose
    // per icon, not the web-manifest `"any maskable"` shorthand.
    icons: [
      { src: '/images/appicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/images/appicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/images/appicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/images/appicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
