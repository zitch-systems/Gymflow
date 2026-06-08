import type { Metadata, Viewport } from 'next';
import './globals.css';

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
  },
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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
