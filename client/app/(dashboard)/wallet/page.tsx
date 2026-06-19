'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchLedger, LedgerEntry, LedgerEntryType } from '../../../lib/services/wallet';
import { formatKES } from '../../../lib/utils';
import styles from './wallet.module.css';

const ENTRY_TYPES: { value: LedgerEntryType | ''; label: string }[] = [
  { value: '',               label: 'All Types' },
  { value: 'DEPOSIT',        label: 'Deposit' },
  { value: 'ESCROW_LOCK',    label: 'Escrow Lock' },
  { value: 'ESCROW_RELEASE', label: 'Escrow Release' },
  { value: 'REFUND',         label: 'Refund' },
  { value: 'SELLER_PAYOUT',  label: 'Seller Payout' },
  { value: 'PLATFORM_FEE',   label: 'Platform Fee' },
  { value: 'DISPUTE_HOLD',   label: 'Dispute Hold' },
];

const CREDIT_TYPES: LedgerEntryType[] = ['DEPOSIT', 'REFUND', 'ESCROW_RELEASE', 'SELLER_PAYOUT'];
const DEBIT_TYPES:  LedgerEntryType[] = ['ESCROW_LOCK', 'PLATFORM_FEE', 'DISPUTE_HOLD'];

function amountClass(type: LedgerEntryType): string {
  if (CREDIT_TYPES.includes(type)) return styles.amountCredit;
  if (DEBIT_TYPES.includes(type))  return styles.amountDebit;
  return styles.amountNeutral;
}

function amountPrefix(type: LedgerEntryType): string {
  if (CREDIT_TYPES.includes(type)) return '+';
  if (DEBIT_TYPES.includes(type))  return '−';
  return '';
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

const PAGE_LIMIT = 20;

export default function WalletLedgerPage() {
  const [selectedType, setSelectedType] = useState<LedgerEntryType | ''>('');

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['ledger', selectedType],
    queryFn: ({ pageParam = 1 }) =>
      fetchLedger(pageParam as number, PAGE_LIMIT, selectedType || undefined),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    initialPageParam: 1,
  });

  const allEntries: LedgerEntry[] = data?.pages.flatMap((p) => p.entries) ?? [];
  const totalCount = data?.pages[0]?.pagination.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Transaction History</h1>
        <p className={styles.subheading}>
          {!isLoading && `${totalCount} entr${totalCount === 1 ? 'y' : 'ies'}`}
        </p>
      </div>

      {/* Filter */}
      <div className={styles.filterBar}>
        <span className={styles.filterLabel}>Filter by type:</span>
        <select
          className={styles.filterSelect}
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as LedgerEntryType | '')}
        >
          {ENTRY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Balance After</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {isError && (
              <tr className={styles.emptyRow}>
                <td colSpan={5} className={styles.errorText}>Failed to load transactions.</td>
              </tr>
            )}

            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className={styles.skeletonRow}>
                  <td><span style={{ width: '60%' }} /></td>
                  <td><span style={{ width: '40%' }} /></td>
                  <td><span style={{ width: '50%' }} /></td>
                  <td><span style={{ width: '55%' }} /></td>
                  <td><span style={{ width: '70%' }} /></td>
                </tr>
              ))}

            {!isLoading && allEntries.length === 0 && (
              <tr className={styles.emptyRow}>
                <td colSpan={5}>No transactions yet.</td>
              </tr>
            )}

            {allEntries.map((entry) => (
              <tr key={entry._id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td>
                  <span className={`${styles.badge} ${styles[entry.type]}`}>
                    {entry.type.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className={amountClass(entry.type)}>
                  {amountPrefix(entry.type)}{formatKES(entry.amountKes)}
                </td>
                <td className={styles.balance}>
                  {formatKES(entry.balanceAfter)}
                </td>
                <td>{entry.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {(hasNextPage || isFetchingNextPage) && (
        <div className={styles.loadMoreWrapper}>
          <button
            className={styles.loadMoreBtn}
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
