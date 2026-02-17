import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Header } from '@/components/layout/header';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Stock Event Tracker',
  description: 'Track stocks and discover market-moving events',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased font-sans">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
