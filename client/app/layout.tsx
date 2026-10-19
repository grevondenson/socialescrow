import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google';
import Providers from './providers';

/**
 * Type: Bricolage Grotesque for display (headings, money, the status rail) and
 * Instrument Sans for body. Both self-hosted by next/font — no third-party request on
 * a slow Kenyan mobile connection.
 *
 * One family carries the brand; the second is a neutral companion. They are clearly
 * distinct at a glance, which is the only reason to use two.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SocialEscrow — buy and sell social accounts without the risk',
    template: '%s · SocialEscrow',
  },
  description:
    'Buy and sell social media accounts in Kenya with M-Pesa escrow. Funds are held until you confirm receipt.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zooming stays enabled — disabling it is a usability trap on small screens.
  maximumScale: 5,
  themeColor: '#F5F6F2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
