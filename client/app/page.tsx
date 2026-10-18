import type { Metadata } from 'next';
import { AppShell } from '../components/layout/AppShell';
import { MarketplaceFeed } from '../components/marketplace/MarketplaceFeed';

export const metadata: Metadata = {
  title: 'Marketplace',
  description:
    'Browse social media accounts for sale. Every trade is protected by M-Pesa escrow — funds release only when you confirm receipt.',
};

/**
 * Marketplace route.
 *
 * Now a server component: the page chrome and copy render without waiting for the
 * client bundle, and only the feed (which needs infinite scroll and filters) is client-side.
 */
export default function MarketplacePage() {
  return (
    <AppShell width="wide">
      <MarketplaceFeed />
    </AppShell>
  );
}
