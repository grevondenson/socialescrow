import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SocialEscrow',
  description: 'Decentralized escrow marketplace for trusted social trading.',
};

import Providers from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
