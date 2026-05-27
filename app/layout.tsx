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
  title: {
    default: 'GymFlow',
    template: '%s — GymFlow',
  },
  description: 'Gym Management SaaS for Nigerian fitness businesses',
  manifest: '/manifest.json',
  applicationName: 'GymFlow',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GymFlow',
  },
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
