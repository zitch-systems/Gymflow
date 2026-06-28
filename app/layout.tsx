import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Inter, JetBrains_Mono } from 'next/font/google';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';

// Self-hosted, preloaded fonts (replaces a render-blocking Google Fonts
// @import). Bound to the --font-* CSS vars that globals.css consumes.
const fontDisplay = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-display', display: 'swap' });
const fontBody = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });
const fontMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://gymflow.ng'),
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
};

// Set the theme before first paint (no flash). Reads the saved choice, else
// falls back to the OS preference. The <html data-theme> is the single source
// of truth the CSS keys off; ThemeToggle updates it + localStorage at runtime.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('gf-theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}<PwaRegister /></body>
    </html>
  );
}
