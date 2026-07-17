import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Space_Grotesk, Instrument_Sans, Spline_Sans_Mono } from 'next/font/google';
import Toasts from '@/components/Toasts';
import './globals.css';

// Display face: Space Grotesk (700) replaces Anton — the old ultra-condensed
// block letters suited the green/brass kit; the geometric grotesk suits the
// apricot→butter gradient identity and still reads great on the score plates.
const spaceGrotesk = Space_Grotesk({
  weight: ['500', '700'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Crixo',
  description: 'Ball-by-ball cricket scoring, live for everyone.',
  // iOS "Add to Home Screen": standalone window with the app's own title.
  appleWebApp: {
    capable: true,
    title: 'Crixo',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  // viewport-fit=cover so env(safe-area-inset-bottom) resolves for the fixed
  // console pad on notched phones (see globals.css).
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFF9F0',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${instrumentSans.variable} ${splineSansMono.variable}`}
    >
      <body>
        {children}
        <Toasts />
      </body>
    </html>
  );
}
