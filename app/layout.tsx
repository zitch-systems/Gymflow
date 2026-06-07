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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
