import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Inter } from 'next/font/google';
import { ToastProvider } from '@/lib/toast';
import { ServiceWorkerRegister } from '@/lib/sw-register';
import { ThemeSystemSync, themeInitScript } from '@/lib/theme';
import { PwaInstallPrompt } from '@/lib/pwa-install';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--gf-font-display-next',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--gf-font-body-next',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng'),
  title: {
    default: 'GymFlow — Gym Management for Nigerian Fitness Businesses',
    template: '%s — GymFlow',
  },
  description: 'Member check-in, Paystack subscriptions, class booking, and automated reminders — one mobile-first platform built for Nigerian gyms.',
  applicationName: 'GymFlow',
  manifest: '/manifest.json',
  keywords: ['gym management', 'gym software Nigeria', 'Paystack subscriptions', 'fitness CRM', 'member check-in', 'GymFlow'],
  authors: [{ name: 'GymFlow' }],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GymFlow',
  },
  openGraph: {
    type: 'website',
    siteName: 'GymFlow',
    title: 'GymFlow — Modern Gym Management for Nigerian Fitness Businesses',
    description: 'Member check-in, Paystack subscriptions, class booking, and automation — in one mobile-first platform that works on Naija data.',
    locale: 'en_NG',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GymFlow — Modern Gym Management',
    description: 'Member check-in, Paystack subscriptions, class booking, and automation for Nigerian gyms.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0a0a12',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jakarta.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <ThemeSystemSync />
        <ServiceWorkerRegister />
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
