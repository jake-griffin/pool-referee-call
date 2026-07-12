import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pool Referee Call App',
  description: 'Digital referee dispatch for pool tournaments',
};

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
