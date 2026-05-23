import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/lib/toast';
import { ServiceWorkerRegister } from '@/lib/sw-register';
import { ThemeSystemSync, themeInitScript } from '@/lib/theme';
import { PwaInstallPrompt } from '@/lib/pwa-install';

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
  themeColor: '#080e1c',
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap"
        />
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
