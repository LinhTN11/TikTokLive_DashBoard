import './globals.css';
import type { Metadata } from 'next';
import { DevIndicatorRemover } from '../src/components/DevIndicatorRemover';

export const metadata: Metadata = {
  title: 'TikTok Live Overlay',
  description: 'Dashboard and overlays for TikTok LIVE chat, gifts, follows, and theme unlocks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ position: 'relative' }}>
        {children}
        <DevIndicatorRemover />
      </body>
    </html>
  );
}
