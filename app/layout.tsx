import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { PwaRegister } from '@/components/pwa-register';
import { SITE_URL } from '@/lib/site-url';
import './globals.css';

// Fonts, served from this repo — see app/fonts/README.md for what the files are
// and how to refresh them.
//
// These used to come from next/font/google. That self-hosts the files at
// RUNTIME, but the BUILD still downloads them from fonts.gstatic.com, and
// Google rotates the hashed filenames: a build whose cache still held the old
// URLs got a 404 for every weight, which Turbopack reported as ~20
// module-not-found errors in the generated font CSS and failed the deploy.
// Nothing in the app had changed. Committing the files removes Google from the
// build path entirely, so a deploy can no longer be broken by someone else's
// CDN — the same reasoning that keeps a lockfile in the repo.
//
// One variable file per family instead of the old five/four/three static
// weights: same range, ~107 KB for all three, and one request each. `weight`
// is the supported range, so every weight globals.css asks for interpolates.
// Latin subset only, matching the previous subsets: ['latin'].
const fontDisplay = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  weight: '400 800',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
  // The stack a browser paints with while the file loads. Metric-adjacent
  // sans faces, so the swap doesn't reflow the page.
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
});
const fontBody = localFont({
  src: './fonts/inter-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-body',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
});
const fontMono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  weight: '400 600',
  style: 'normal',
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'GymFlow — Run your gym the modern way',
    template: '%s · GymFlow',
  },
  description:
    'Check-ins, Paystack subscriptions, class booking and automated reminders — one mobile-first platform, light enough to fly on Nigerian networks.',
  openGraph: {
    type: 'website',
    title: 'GymFlow',
    siteName: 'GymFlow',
    locale: 'en_NG',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'GymFlow' }],
  },
  twitter: { card: 'summary_large_image', title: 'GymFlow', images: ['/images/og.png'] },
  // Installable PWA ("add to home screen") — manifest served by app/manifest.ts.
  // Favicon + touch icon come from app/icon.svg and app/apple-icon.png (file
  // conventions); PWA icons live in app/manifest.ts. Service worker is
  // public/sw.js, registered at runtime by components/pwa-register.tsx.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'GymFlow' },
};

export const viewport: Viewport = {
  themeColor: '#0a0a12',
  width: 'device-width',
  initialScale: 1,
  // Let the app paint under the iOS home indicator / notch so the fixed
  // bottom tab bars can pad with env(safe-area-inset-bottom) instead of
  // sitting on an opaque letterbox strip.
  viewportFit: 'cover',
};

// Set the theme before first paint (no flash). Reads the saved choice, else
// falls back to the OS preference. The <html data-theme> is the single source
// of truth the CSS keys off; ThemeToggle updates it + localStorage at runtime.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('gf-theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// Organization structured data (sitewide) for richer brand presence in search.
const ORG_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'GymFlow',
  url: SITE_URL,
  logo: `${SITE_URL}/images/og.png`,
  description: 'Mobile-first gym management software for Nigerian gyms — check-ins, Paystack subscriptions, class booking and automated reminders.',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ORG_LD }} />
      </head>
      <body>
        <a href="#main-content" className="skip-link">Skip to content</a>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
