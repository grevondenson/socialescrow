'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { AppShell } from '../../../components/layout/AppShell';
import WalletCard from '../../../components/dashboard/WalletCard';
import { Card, CardHeader, Stat } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import {
  fetchWallet,
  fetchLedger,
  type LedgerEntry,
  type LedgerEntryType,
} from '../../../lib/services/wallet';
import { formatKES, formatDateTime } from '../../../lib/utils';

/**
 * Seller dashboard.
 *
 * There is no seller-scoped payout endpoint for a *list*, so "what happened to my money"
 * is reconstructed from the two reads the wallet screens already use:
 *   GET /wallet        -> pendingPayout / availableBalance / lockedInEscrow
 *   GET /wallet/ledger -> SELLER_PAYOUT rows (credited on escrow release) and
 *                         PLATFORM_FEE rows (deducted, written with the seller as `user`)
 * The ledger's `type` filter is single-valued server-side, so both are fetched in parallel
 * and merged here.
 *
 * Per-trade live payout state (pending approval → sent) lives in the trade room, where it
 * is scoped to the seller by GET /trades/:id/payout.
 */

const PAYOUT_TYPES: { type: LedgerEntryType; label: string; tone: 'credit' | 'fee' }[] = [
  { type: 'SELLER_PAYOUT', label: 'Payout received', tone: 'credit' },
  { type: 'PLATFORM_FEE', label: 'Platform fee', tone: 'fee' },
];

const HISTORY_LIMIT = 20;

interface PayoutRow extends LedgerEntry {
  tone: 'credit' | 'fee';
  label: string;
}

const sortNewestFirst = (a: LedgerEntry, b: LedgerEntry) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

export default function SellerDashboardPage() {
  const [showAll, setShowAll] = useState(false);

  // Shares the ['wallet'] key with <WalletCard/>, so this does not double-fetch.
  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const payoutQuery = useInfiniteQuery({
    queryKey: ['seller', 'payout-history'],
    queryFn: async ({ pageParam }) => {
      const [payouts, fees] = await Promise.all([
        fetchLedger(pageParam, HISTORY_LIMIT, 'SELLER_PAYOUT'),
        fetchLedger(pageParam, HISTORY_LIMIT, 'PLATFORM_FEE'),
      ]);
      return { payouts, fees };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.payouts.pagination.hasMore || lastPage.fees.pagination.hasMore
        ? lastPage.payouts.pagination.page + 1
        : undefined,
    refetchOnWindowFocus: false,
  });

  const wallet = walletQuery.data;

  const rows = useMemo<PayoutRow[]>(() => {
    const pages = payoutQuery.data?.pages ?? [];
    const seen = new Set<string>();
    const merged: PayoutRow[] = [];

    for (const page of pages) {
      for (const entry of page.payouts.entries) {
        if (seen.has(entry._id)) continue;
        seen.add(entry._id);
        merged.push({ ...entry, tone: 'credit', label: 'Payout received' });
      }
      for (const entry of page.fees.entries) {
        if (seen.has(entry._id)) continue;
        seen.add(entry._id);
        merged.push({ ...entry, tone: 'fee', label: 'Platform fee' });
      }
    }

    return merged.sort(sortNewestFirst);
  }, [payoutQuery.data]);

  const counts = useMemo(() => {
    const first = payoutQuery.data?.pages[0];
    return {
      payouts: first?.payouts.pagination.total ?? 0,
      fees: first?.fees.pagination.total ?? 0,
    };
  }, [payoutQuery.data]);

  const visibleRows = showAll ? rows : rows.slice(0, 6);

  return (
    <AppShell width="default">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Selling
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Your balance, what escrow is holding, and what M-Pesa has paid out.
          </p>
        </div>
        <Link href="/listing/create">
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            List an account
          </Button>
        </Link>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <WalletCard />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <section>
            <h2 className="mb-2.5 font-display text-sm font-semibold text-ink">Payout status</h2>

            {walletQuery.isError ? (
              <ErrorState
                title="Balances did not load"
                onRetry={() => void walletQuery.refetch()}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Pending payout"
                  value={wallet ? formatKES(wallet.pendingPayout) : '—'}
                  hint="Owed to you; awaiting M-Pesa"
                  tone="ochre"
                />
                <Stat
                  label="Available"
                  value={wallet ? formatKES(wallet.availableBalance) : '—'}
                  hint="Cleared funds you can use"
                  tone="forest"
                />
                <Stat
                  label="In escrow"
                  value={wallet ? formatKES(wallet.lockedInEscrow) : '—'}
                  hint="Held against active trades"
                  tone="neutral"
                />
              </div>
            )}
          </section>

          <Card className="mt-5" flush>
            <div className="px-5 pt-5 sm:px-6">
              <CardHeader
                title="Payout history"
                description={`${counts.payouts} payout${counts.payouts === 1 ? '' : 's'} · ${counts.fees} fee${counts.fees === 1 ? '' : 's'}`}
              />
            </div>

            {payoutQuery.isLoading ? (
              <div className="space-y-2 px-5 pb-5 sm:px-6">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : payoutQuery.isError ? (
              <div className="px-5 pb-5 sm:px-6">
                <ErrorState
                  title="Payout history did not load"
                  onRetry={() => void payoutQuery.refetch()}
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="px-5 pb-5 sm:px-6">
                <EmptyState
                  compact
                  title="No payouts yet"
                  description="When a buyer confirms receipt on a trade, your payout appears here."
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH numeric>Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {visibleRows.map((row) => (
                    <TR key={row._id}>
                      <TD>
                        <span className="tnum text-xs text-neutral-500">
                          {formatDateTime(row.createdAt)}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={row.tone === 'credit' ? 'success' : 'neutral'}>
                          {row.label}
                        </Badge>
                        {row.note && (
                          <p className="mt-0.5 max-w-[16rem] truncate text-2xs text-neutral-400" title={row.note}>
                            {row.note}
                          </p>
                        )}
                      </TD>
                      <TD numeric>
                        <span className={row.tone === 'credit' ? 'text-forest-700' : 'text-clay-600'}>
                          {row.tone === 'credit' ? '+' : '−'}
                          {formatKES(row.amountKes)}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3 px-5 py-4 sm:px-6">
              {rows.length > 6 && (
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${rows.length}`}
                </Button>
              )}
              {payoutQuery.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void payoutQuery.fetchNextPage()}
                  isPending={payoutQuery.isFetchingNextPage}
                >
                  Load older payouts
                </Button>
              )}
            </div>
          </Card>

          <p className="mt-3 text-xs leading-4 text-neutral-500">
            Payouts go to the M-Pesa number on your KYC. Each one is approved by an admin
            before it is sent — that review is what protects you from a hijacked account
            taking the money with it.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
