'use client';

import { useMemo, useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import WalletCard from '../../../components/dashboard/WalletCard';
import {
  fetchWallet,
  fetchLedger,
  type LedgerEntry,
  type LedgerEntryType,
} from '../../../lib/services/wallet';
import { formatKES } from '../../../lib/utils';

// ── Payout history ─────────────────────────────────────────────────────────────
//
// There is no seller-scoped payout endpoint. PayoutQueue is admin-only, so the
// seller's view of "what happened to my money" is reconstructed from the same two
// reads the wallet screens already use:
//   GET /wallet        -> pendingPayout / availableBalance / lockedInEscrow
//   GET /wallet/ledger -> SELLER_PAYOUT rows (money credited to pendingPayout on
//                         escrow release) and PLATFORM_FEE rows (the fee deducted,
//                         written with the seller as `user` by convention).
// The ledger's `type` filter is server-side and single-valued, so the two types are
// fetched in parallel and merged here rather than in two sequential round-trips.

const PAYOUT_TYPES: { type: LedgerEntryType; label: string; tone: 'credit' | 'fee' }[] = [
  { type: 'SELLER_PAYOUT', label: 'Payout received', tone: 'credit' },
  { type: 'PLATFORM_FEE', label: 'Platform fee', tone: 'fee' },
];

const HISTORY_LIMIT = 20;

const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const sortNewestFirst = (a: LedgerEntry, b: LedgerEntry): number =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

interface PayoutRow extends LedgerEntry {
  tone: 'credit' | 'fee';
  label: string;
}

function StatusTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        background: '#fff',
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: accent,
            display: 'inline-block',
          }}
        />
        <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>
          {label}
        </p>
      </div>
      <p style={{ marginTop: 8, fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>{value}</p>
      <p style={{ marginTop: 4, fontSize: '0.8125rem', color: '#64748b' }}>{hint}</p>
    </div>
  );
}

export default function SellerDashboardPage() {
  const [showAll, setShowAll] = useState(false);

  // Shares the ['wallet'] cache key with <WalletCard/>, so this does not double-fetch.
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
    getNextPageParam: (lastPage) => {
      const more = lastPage.payouts.pagination.hasMore || lastPage.fees.pagination.hasMore;
      return more ? lastPage.payouts.pagination.page + 1 : undefined;
    },
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
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>
        Seller Dashboard
      </h1>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <WalletCard />
      </div>

      {/* ── Payout status ─────────────────────────────────────────────── */}
      <section style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a' }}>Payout status</h2>
          {payoutQuery.isFetching && (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Refreshing…</span>
          )}
        </div>

        {walletQuery.isError && (
          <p style={{ marginTop: 12, fontSize: '0.875rem', color: '#b91c1c' }}>
            {(walletQuery.error as { response?: { data?: { message?: string } } })?.response?.data?.message
              || 'Failed to load payout balances.'}
          </p>
        )}

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatusTile
            label="Pending payout"
            value={wallet ? formatKES(wallet.pendingPayout) : '—'}
            hint="Released to you, awaiting M-Pesa disbursement"
            accent="#f59e0b"
          />
          <StatusTile
            label="Available"
            value={wallet ? formatKES(wallet.availableBalance) : '—'}
            hint="Cleared funds in your wallet"
            accent="#10b981"
          />
          <StatusTile
            label="In escrow"
            value={wallet ? formatKES(wallet.lockedInEscrow) : '—'}
            hint="Held against active trades"
            accent="#6366f1"
          />
        </div>
      </section>

      {/* ── Payout history ────────────────────────────────────────────── */}
      <section style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a' }}>Payout history</h2>
          <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
            {counts.payouts} payout{counts.payouts === 1 ? '' : 's'} · {counts.fees} fee{counts.fees === 1 ? '' : 's'}
          </span>
        </div>

        <div
          style={{
            marginTop: 16,
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          {payoutQuery.isLoading && (
            <div style={{ padding: 24 }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 16,
                    borderRadius: 6,
                    background: '#f1f5f9',
                    marginBottom: 12,
                    width: `${90 - i * 12}%`,
                  }}
                />
              ))}
            </div>
          )}

          {payoutQuery.isError && (
            <p style={{ padding: 24, fontSize: '0.875rem', color: '#b91c1c' }}>
              Failed to load payout history.
            </p>
          )}

          {!payoutQuery.isLoading && !payoutQuery.isError && rows.length === 0 && (
            <p style={{ padding: 24, fontSize: '0.875rem', color: '#64748b' }}>
              No payouts yet. Once a trade is completed and escrow releases, the payout appears here.
            </p>
          )}

          {!payoutQuery.isLoading && !payoutQuery.isError && visibleRows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                  <th style={{ padding: '10px 16px', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '10px 16px', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: '10px 16px', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row._id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', color: '#475569', whiteSpace: 'nowrap' }}>
                      {formatDate(row.createdAt)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          borderRadius: 999,
                          border: `1px solid ${row.tone === 'credit' ? '#a7f3d0' : '#e2e8f0'}`,
                          background: row.tone === 'credit' ? '#ecfdf5' : '#f8fafc',
                          color: row.tone === 'credit' ? '#047857' : '#475569',
                          padding: '2px 8px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {row.label}
                      </span>
                      {row.note && (
                        <p style={{ marginTop: 4, fontSize: '0.75rem', color: '#94a3b8' }}>{row.note}</p>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        color: row.tone === 'credit' ? '#047857' : '#b91c1c',
                      }}
                    >
                      {row.tone === 'credit' ? '+' : '−'}
                      {formatKES(row.amountKes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rows.length > 6 && (
            <div style={{ borderTop: '1px solid #f1f5f9', padding: '10px 16px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                {showAll ? 'Show less' : `Show all ${rows.length}`}
              </button>
            </div>
          )}
        </div>

        {payoutQuery.hasNextPage && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => payoutQuery.fetchNextPage()}
              disabled={payoutQuery.isFetchingNextPage}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                background: '#fff',
                padding: '8px 16px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#334155',
                cursor: payoutQuery.isFetchingNextPage ? 'not-allowed' : 'pointer',
                opacity: payoutQuery.isFetchingNextPage ? 0.5 : 1,
              }}
            >
              {payoutQuery.isFetchingNextPage ? 'Loading…' : 'Load older payouts'}
            </button>
          </div>
        )}

        <p style={{ marginTop: 12, fontSize: '0.75rem', color: '#94a3b8' }}>
          Payouts are sent to your registered M-Pesa number. Pending payouts are queued for admin approval.
        </p>
      </section>
    </main>
  );
}
