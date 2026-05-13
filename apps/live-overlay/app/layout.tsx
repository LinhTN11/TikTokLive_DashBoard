import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TikTok Live Overlay',
  description: 'Dashboard and overlays for TikTok LIVE chat, gifts, follows, and theme unlocks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
