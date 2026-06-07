// Minimal root layout — blank-slate baseline. All previous UI primitives,
// fonts, theme system, toast provider, service worker registration, and
// version watcher were intentionally removed. Add them back as you rebuild.
//
// API routes under app/api/* don't render via this layout, so the cron +
// Paystack + onboarding flows keep working.

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
