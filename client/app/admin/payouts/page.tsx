'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePayout,
  fetchPayoutQueue,
  getApiErrorMessage,
  rejectPayout,
  requeuePayout,
  PAYOUT_STATUSES,
  type PayoutQueueItem,
  type PayoutStatus,
} from '../../../lib/services/adminOps';
import { formatKES } from '../../../lib/utils';

/**
 * Seller payout queue — the critical money path.
 *
 * AUTO_PAYOUT defaults to false, so every completed trade parks its payout at
 * `pending_approval` until an admin acts here. Approving flips the row to `approved` and
 * enqueues the B2C worker; rejecting cancels it without clawing the money back (the seller
 * is still owed it); re-queueing only works on `cancelled` rows.
 */

type StatusFilter = PayoutStatus | 'all';

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<PayoutStatus, string> = {
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-sky-50 text-sky-700 border-sky-200',
  processing: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const statusLabel = (status: PayoutStatus) =>
  STATUS_TABS.find((tab) => tab.value === status)?.label ?? status;

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

/** A mutation in flight is keyed by `${id}:${action}` so only that row's button locks. */
type ActionKey = `${string}:${'approve' | 'reject' | 'requeue'}`;

export default function AdminPayoutsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending_approval');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<ActionKey | null>(null);

  const queryKey = ['admin', 'payouts', statusFilter, page];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      fetchPayoutQueue({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        per_page: 25,
      }),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
    ]);

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvePayout(id),
    onSuccess: invalidate,
    onError: (err) => setActionError(getApiErrorMessage(err, 'Could not approve this payout.')),
    onSettled: () => setBusyKey(null),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectPayout(id, reason),
    onSuccess: invalidate,
    onError: (err) => setActionError(getApiErrorMessage(err, 'Could not reject this payout.')),
    onSettled: () => setBusyKey(null),
  });

  const requeueMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => requeuePayout(id, reason),
    onSuccess: invalidate,
    onError: (err) => setActionError(getApiErrorMessage(err, 'Could not re-queue this payout.')),
    onSettled: () => setBusyKey(null),
  });

  const handleApprove = (payout: PayoutQueueItem) => {
    setActionError(null);
    const confirmed = window.confirm(
      `Approve ${formatKES(payout.amountKes)} to ${payout.seller?.fullName ?? 'this seller'}? ` +
        'This releases real money via M-Pesa B2C.'
    );
    if (!confirmed) return;
    setBusyKey(`${payout._id}:approve`);
    approveMutation.mutate(payout._id);
  };

  const handleReject = (payout: PayoutQueueItem) => {
    setActionError(null);
    const reason = window.prompt(
      'Reason for rejecting this payout? (recorded in the audit log; the seller is still owed the money)',
      ''
    );
    if (reason === null) return;
    if (reason.trim() === '') {
      setActionError('A reason is required to reject a payout.');
      return;
    }
    setBusyKey(`${payout._id}:reject`);
    rejectMutation.mutate({ id: payout._id, reason: reason.trim() });
  };

  const handleRequeue = (payout: PayoutQueueItem) => {
    setActionError(null);
    const reason = window.prompt('Reason for re-queuing this cancelled payout?', '');
    if (reason === null) return;
    setBusyKey(`${payout._id}:requeue`);
    requeueMutation.mutate({ id: payout._id, reason: reason.trim() });
  };

  const payouts = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta ? Math.max(Math.ceil(meta.total / Math.max(meta.per_page, 1)), 1) : 1;

  return (
    <main className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Seller Payouts</h2>
          <p className="mt-1 text-sm text-slate-500">
            Approve queued M-Pesa B2C disbursements. Payouts only move once an admin approves
            an amount here.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">{meta?.total ?? 0}</span> payout
          {meta?.total === 1 ? '' : 's'} in the current view
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
                setActionError(null);
              }}
              className={
                active
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm'
                  : 'rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {actionError && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs font-semibold uppercase tracking-widest text-red-500 hover:text-red-700"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-slate-500">Loading payout queue...</div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-600">
          {getApiErrorMessage(error, 'Failed to load the payout queue.')}
        </div>
      ) : payouts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No payouts match this filter.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {['Seller', 'Amount', 'Trade', 'Status', 'Created', 'Actions'].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payouts.map((payout) => (
                  <PayoutRow
                    key={payout._id}
                    payout={payout}
                    busyKey={busyKey}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onRequeue={handleRequeue}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / narrow cards */}
          <div className="space-y-3 lg:hidden">
            {payouts.map((payout) => (
              <div
                key={payout._id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {payout.seller?.fullName ?? 'Unknown seller'}
                    </p>
                    <p className="text-xs text-slate-500">{payout.seller?.phone ?? 'No phone'}</p>
                  </div>
                  <span
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[payout.status]}`}
                  >
                    {statusLabel(payout.status)}
                  </span>
                </div>
                <p className="mt-3 text-lg font-bold text-slate-900">{formatKES(payout.amountKes)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Trade {payout.trade?._id ?? '—'} · {payout.trade?.status ?? 'unknown'}
                </p>
                <p className="text-xs text-slate-400">Created {formatDate(payout.createdAt)}</p>
                {payout.lastError && (
                  <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                    {payout.lastError}
                  </p>
                )}
                <div className="mt-3 flex flex-col gap-2">
                  <PayoutActions
                    payout={payout}
                    busyKey={busyKey}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onRequeue={handleRequeue}
                    stacked
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <span>
            Page {meta?.page ?? page} of {totalPages} · {meta?.total ?? 0} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
              disabled={page <= 1}
              className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-50 disabled:text-slate-300"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
              disabled={page >= totalPages}
              className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-50 disabled:text-slate-300"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

interface PayoutActionsProps {
  payout: PayoutQueueItem;
  busyKey: ActionKey | null;
  onApprove: (payout: PayoutQueueItem) => void;
  onReject: (payout: PayoutQueueItem) => void;
  onRequeue: (payout: PayoutQueueItem) => void;
  stacked?: boolean;
}

function PayoutActions({ payout, busyKey, onApprove, onReject, onRequeue, stacked }: PayoutActionsProps) {
  const approveBusy = busyKey === `${payout._id}:approve`;
  const rejectBusy = busyKey === `${payout._id}:reject`;
  const requeueBusy = busyKey === `${payout._id}:requeue`;
  const anyBusy = approveBusy || rejectBusy || requeueBusy;

  // Approve only at pending_approval; reject from pending_approval or approved;
  // re-queue only from cancelled (the backend refuses `failed` by design).
  const canApprove = payout.status === 'pending_approval';
  const canReject = payout.status === 'pending_approval' || payout.status === 'approved';
  const canRequeue = payout.status === 'cancelled';

  if (!canApprove && !canReject && !canRequeue) {
    return <span className="text-xs text-slate-400">No actions</span>;
  }

  return (
    <div className={stacked ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
      {canApprove && (
        <button
          type="button"
          onClick={() => onApprove(payout)}
          disabled={anyBusy}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:bg-slate-300"
        >
          {approveBusy ? 'Approving...' : 'Approve'}
        </button>
      )}
      {canReject && (
        <button
          type="button"
          onClick={() => onReject(payout)}
          disabled={anyBusy}
          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-300"
        >
          {rejectBusy ? 'Rejecting...' : 'Reject'}
        </button>
      )}
      {canRequeue && (
        <button
          type="button"
          onClick={() => onRequeue(payout)}
          disabled={anyBusy}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:text-slate-300"
        >
          {requeueBusy ? 'Re-queuing...' : 'Re-queue'}
        </button>
      )}
    </div>
  );
}

function PayoutRow({
  payout,
  busyKey,
  onApprove,
  onReject,
  onRequeue,
}: PayoutActionsProps) {
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <p className="font-semibold text-slate-900">{payout.seller?.fullName ?? 'Unknown seller'}</p>
        <p className="text-xs text-slate-500">{payout.seller?.phone ?? 'No phone'}</p>
        <p className="text-xs text-slate-400">{payout.seller?.email ?? 'No email'}</p>
      </td>
      <td className="px-4 py-4 font-semibold text-slate-900">{formatKES(payout.amountKes)}</td>
      <td className="px-4 py-4">
        <p className="font-mono text-xs text-slate-600">{payout.trade?._id ?? '—'}</p>
        <p className="text-xs text-slate-500">{payout.trade?.status ?? 'unknown'}</p>
      </td>
      <td className="px-4 py-4">
        <span
          className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[payout.status]}`}
        >
          {statusLabel(payout.status)}
        </span>
        {payout.lastError && (
          <p className="mt-2 max-w-xs rounded-xl bg-red-50 px-2 py-1 text-xs text-red-700">
            {payout.lastError}
          </p>
        )}
      </td>
      <td className="px-4 py-4 text-xs text-slate-500">
        <p>{formatDate(payout.createdAt)}</p>
        {payout.sentAt && <p className="text-emerald-600">Sent {formatDate(payout.sentAt)}</p>}
      </td>
      <td className="px-4 py-4">
        <PayoutActions
          payout={payout}
          busyKey={busyKey}
          onApprove={onApprove}
          onReject={onReject}
          onRequeue={onRequeue}
        />
      </td>
    </tr>
  );
}
