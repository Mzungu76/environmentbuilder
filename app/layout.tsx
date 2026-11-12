import type { Metadata, Viewport } from 'next';
import './globals.css';
import { MobileShell } from '@/components/shell/pwa';

export const metadata: Metadata = {
  title: 'Environment Builder',
  description: 'Editor universale di ambienti 2D e motore di esplorazione',
  manifest: 'manifest.webmanifest',
  icons: { icon: [{ url: 'icon.svg', type: 'image/svg+xml' }, { url: 'icon-192.png', sizes: '192x192', type: 'image/png' }], apple: 'icon-192.png' },
  appleWebApp: { capable: true, title: 'EnvBuilder', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover', themeColor: '#0f1115' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}<MobileShell /></body>
    </html>
  );
}
