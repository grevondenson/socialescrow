'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Select } from '../../../components/ui/Field';
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { statusMeta, TRADE_STATUS } from '../../../lib/status';
import { formatKES, formatDateTime, shortId } from '../../../lib/utils';
import { getApiErrorMessage } from '../../../lib/services/adminOps';

interface AdminTrade {
  _id: string;
  status: string;
  amountKes: number;
  platformFeeKes: number;
  sellerPayoutKes: number;
  createdAt: string;
  buyer?: { _id: string; fullName?: string; email?: string } | null;
  seller?: { _id: string; fullName?: string; email?: string } | null;
  listing?: { _id: string; platform?: string; niche?: string } | null;
}

const STATUS_OPTIONS = [
  'pending',
  'payment_window',
  'paid',
  'credentials_released',
  'completed',
  'disputed',
  'cancelled',
];

const PER_PAGE = 25;

/**
 * Trades table.
 *
 * Replaces an 8-line placeholder. Read-only on purpose: every state transition already
 * has a real endpoint with its own authorisation and audit trail (confirm, release,
 * dispute, payout). A generic "change status" control here would be a way to move money
 * without any of those guards.
 */
export default function AdminTradesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'trades', status, page],
    queryFn: async () => {
      const { data } = await api.get('/admin/trades', {
        params: { status: status || undefined, page, per_page: PER_PAGE },
      });
      return data as { data: AdminTrade[]; meta: { total: number; page: number; per_page: number } };
    },
  });

  const trades = query.data?.data ?? [];
  const total = query.data?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Trades</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Every trade in the system, newest first. Money actions happen in the trade room,
            not here.
          </p>
        </div>

        <div className="w-full sm:w-56">
          <label htmlFor="trade-status" className="mb-1 block text-xs font-medium text-neutral-600">
            Status
          </label>
          <Select
            id="trade-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {statusMeta(TRADE_STATUS, value).label}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <Card flush>
        <div className="px-5 pt-5 sm:px-6">
          <p className="tnum text-xs text-neutral-500">{total} trades</p>
        </div>

        {query.isLoading ? (
          <div className="space-y-2 px-5 py-4 sm:px-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="p-5 sm:p-6">
            <ErrorState
              title="Trades did not load"
              description={getApiErrorMessage(query.error, 'The trades endpoint failed.')}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : trades.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState
              title="No trades here"
              description={
                status
                  ? `No trades are currently ${statusMeta(TRADE_STATUS, status).label.toLowerCase()}.`
                  : 'Trades appear as soon as a buyer starts one.'
              }
            />
          </div>
        ) : (
          <div className="mt-2 pb-4">
            <Table>
              <THead>
                <TR>
                  <TH>Trade</TH>
                  <TH>Listing</TH>
                  <TH>Buyer</TH>
                  <TH>Seller</TH>
                  <TH>Status</TH>
                  <TH numeric>Amount</TH>
                  <TH>Opened</TH>
                </TR>
              </THead>
              <TBody>
                {trades.map((trade) => {
                  const meta = statusMeta(TRADE_STATUS, trade.status);
                  return (
                    <TR key={trade._id}>
                      <TD>
                        <Link
                          href={`/trade/${trade._id}`}
                          className="tnum font-medium text-forest-700 hover:underline"
                        >
                          {shortId(trade._id)}
                        </Link>
                      </TD>
                      <TD>
                        {trade.listing ? (
                          <span className="text-sm">
                            {trade.listing.platform}
                            <span className="text-neutral-400"> · </span>
                            {trade.listing.niche}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </TD>
                      <TD>{trade.buyer?.fullName ?? <span className="text-neutral-400">—</span>}</TD>
                      <TD>{trade.seller?.fullName ?? <span className="text-neutral-400">—</span>}</TD>
                      <TD>
                        <Badge tone={meta.tone} dot>
                          {meta.label}
                        </Badge>
                      </TD>
                      <TD numeric>
                        <span className="font-medium text-ink">{formatKES(trade.amountKes)}</span>
                      </TD>
                      <TD>
                        <span className="tnum text-xs text-neutral-500">
                          {formatDateTime(trade.createdAt)}
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}

        {trades.length > 0 && (
          <div className="px-5 pb-4 sm:px-6">
            <Pagination
              page={page}
              perPage={PER_PAGE}
              total={total}
              onPageChange={setPage}
              label="trades"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
