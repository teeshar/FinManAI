import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FinManAI',
  description: 'Personal financial planning for Indian households',
  // This app holds financial data. Keep it out of search results and previews.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[color:var(--surface)] antialiased">{children}</body>
    </html>
  );
}
