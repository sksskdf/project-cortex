import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { ko } from '@/copy/ko';
import './globals.css';

export const metadata: Metadata = {
  title: ko.app.name,
  description: ko.app.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="dark">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
