'use client';

import Link from 'next/link';
import { Plus, Store } from 'lucide-react';
import { AppShell } from '../../../components/layout/AppShell';
import WalletCard from '../../../components/dashboard/WalletCard';
import { Button } from '../../../components/ui/Button';

/**
 * Buyer dashboard.
 *
 * Deliberately thin: there is no buyer-scoped "my trades" list endpoint yet, so the page
 * shows the wallet and points at the marketplace. A fake "recent trades" table would have
 * to be invented, and inventing money state is exactly what this product must not do.
 */
export default function BuyerDashboardPage() {
  return (
    <AppShell width="default">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Buying
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Your balance, and what the platform is currently holding for you.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <WalletCard />

        <div className="flex flex-col justify-between rounded-card border border-neutral-200 bg-white p-5 shadow-card">
          <div>
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-forest-50 text-forest">
              <Store className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="font-display text-base font-semibold text-ink">Find an account</h2>
            <p className="mt-1 text-sm leading-5 text-neutral-600">
              Every purchase is protected: the money is locked with the platform until you
              confirm you received the account.
            </p>
          </div>
          <Link href="/" className="mt-4">
            <Button variant="secondary" fullWidth>
              Browse the marketplace
            </Button>
          </Link>
        </div>
      </div>

      <section className="mt-6 rounded-card border border-neutral-200 bg-white p-5">
        <h2 className="font-display text-sm font-semibold text-ink">Ready to sell instead?</h2>
        <p className="mt-1 text-sm leading-5 text-neutral-600">
          Listing is free. You only pay the 6% fee when a trade completes.
        </p>
        <Link href="/listing/create" className="mt-3 inline-block">
          <Button variant="ghost" size="sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            List an account
          </Button>
        </Link>
      </section>
    </AppShell>
  );
}
