'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDisputes,
  getApiErrorMessage,
  resolveDispute,
  type DisputeItem,
  type DisputeResolution,
} from '../../../lib/services/adminOps';
import { formatKES } from '../../../lib/utils';

/**
 * Open dispute queue. GET /admin/disputes only ever returns non-resolved disputes
 * (`status: { $ne: 'resolved' }`), so there is no resolved tab to build.
 *
 * Resolution moves real money inside one server-side transaction:
 *   release_to_seller / refund_to_buyer -> whole escrowed deposit, one direction
 *   split -> buyerAmount + sellerAmount MUST sum to trade.amountKes (escrow.service.js:366)
 */

const RESOLUTION_OPTIONS: Array<{ value: DisputeResolution; label: string; hint: string }> = [
  {
    value: 'release_to_seller',
    label: 'Release to seller',
    hint: 'Full escrowed deposit goes to the seller. 6% platform fee applies.',
  },
  {
    value: 'refund_to_buyer',
    label: 'Refund to buyer',
    hint: 'Full escrowed deposit returns to the buyer.',
  },
  {
    value: 'split',
    label: 'Split',
    hint: 'Both amounts must be numbers and must add up to the escrowed deposit.',
  },
];

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  under_review: 'bg-sky-50 text-sky-700 border-sky-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

/** Parse a user-typed amount, rejecting blanks so '' never coerces to 0. */
const parseAmount = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export default function AdminDisputesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const queryKey = ['admin', 'disputes', page];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => fetchDisputes({ page, limit: 25 }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof resolveDispute>[1];
    }) => resolveDispute(id, payload),
    onSuccess: async () => {
      setActionError(null);
      setSuccessMessage('Dispute resolved and the trade has been updated.');
      setOpenId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'disputes'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ]);
    },
    onError: (err) => {
      setSuccessMessage(null);
      setActionError(getApiErrorMessage(err, 'Could not resolve this dispute.'));
    },
  });

  const disputes = data?.disputes ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.pages ?? 1;

  return (
    <main className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Dispute Queue</h2>
          <p className="mt-1 text-sm text-slate-500">
            Trade disputes awaiting a ruling. Resolving one moves escrowed funds immediately
            and cannot be undone.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">{pagination?.total ?? 0}</span> open dispute
          {pagination?.total === 1 ? '' : 's'}
        </div>
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

      {successMessage && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs font-semibold uppercase tracking-widest text-emerald-600 hover:text-emerald-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-slate-500">Loading dispute queue...</div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-600">
          {getApiErrorMessage(error, 'Failed to load disputes.')}
        </div>
      ) : disputes.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No open disputes. Nice.
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <DisputeCard
              key={dispute._id}
              dispute={dispute}
              expanded={openId === dispute._id}
              submitting={resolveMutation.isPending}
              onToggle={() => {
                setActionError(null);
                setSuccessMessage(null);
                setOpenId((current) => (current === dispute._id ? null : dispute._id));
              }}
              onSubmit={(payload) => {
                setActionError(null);
                setSuccessMessage(null);
                resolveMutation.mutate({ id: dispute._id, payload });
              }}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <span>
            Page {pagination?.page ?? page} of {totalPages} · {pagination?.total ?? 0} total
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

interface DisputeCardProps {
  dispute: DisputeItem;
  expanded: boolean;
  submitting: boolean;
  onToggle: () => void;
  onSubmit: (payload: {
    resolution: DisputeResolution;
    buyerAmount?: number;
    sellerAmount?: number;
    adminNotes?: string;
  }) => void;
}

function DisputeCard({ dispute, expanded, submitting, onToggle, onSubmit }: DisputeCardProps) {
  const [resolution, setResolution] = useState<DisputeResolution | ''>('');
  const [buyerAmount, setBuyerAmount] = useState('');
  const [sellerAmount, setSellerAmount] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const escrowed = dispute.trade?.amountKes ?? 0;
  const statusClass = STATUS_STYLES[dispute.status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  const hint = RESOLUTION_OPTIONS.find((option) => option.value === resolution)?.hint;

  // Live split arithmetic, shown as a hint rather than enforced silently.
  const buyerParsed = parseAmount(buyerAmount);
  const sellerParsed = parseAmount(sellerAmount);
  const splitRemainder =
    buyerParsed !== null && sellerParsed !== null
      ? Number((escrowed - buyerParsed - sellerParsed).toFixed(2))
      : null;

  const submit = () => {
    if (!resolution) {
      setFormError('Choose a resolution before submitting.');
      return;
    }

    if (resolution === 'split') {
      if (buyerParsed === null || sellerParsed === null) {
        setFormError('Split requires a numeric buyer amount and seller amount.');
        return;
      }
      if (buyerParsed < 0 || sellerParsed < 0) {
        setFormError('Split amounts cannot be negative.');
        return;
      }
      // escrow.service.js requires an exact numeric match against trade.amountKes. Compare
      // the same way here so the admin sees the mismatch before a transaction is opened.
      if (buyerParsed + sellerParsed !== escrowed) {
        setFormError(
          `Buyer and seller amounts must add up to ${formatKES(escrowed)} (currently ${formatKES(
            buyerParsed + sellerParsed
          )}).`
        );
        return;
      }
    }

    setFormError(null);
    const confirmed = window.confirm(
      resolution === 'split'
        ? `Resolve as split: ${formatKES(buyerParsed ?? 0)} to buyer, ${formatKES(
            sellerParsed ?? 0
          )} to seller? This moves funds immediately.`
        : `Resolve as "${RESOLUTION_OPTIONS.find((option) => option.value === resolution)?.label}"? ` +
          `This moves ${formatKES(escrowed)} immediately and cannot be undone.`
    );
    if (!confirmed) return;

    onSubmit({
      resolution,
      ...(resolution === 'split'
        ? { buyerAmount: buyerParsed ?? undefined, sellerAmount: sellerParsed ?? undefined }
        : {}),
      ...(adminNotes.trim() !== '' ? { adminNotes: adminNotes.trim() } : {}),
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}
            >
              {dispute.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-400">Opened {formatDate(dispute.createdAt)}</span>
          </div>
          <p className="font-semibold text-slate-900">
            {dispute.raisedBy?.fullName ?? 'Unknown user'}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {dispute.raisedBy?.email ?? ''}
            </span>
          </p>
          <p className="max-w-2xl text-sm text-slate-700">{dispute.reason}</p>
        </div>

        <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:w-72">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Escrowed</p>
            <p className="font-semibold text-slate-900">{formatKES(escrowed)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Trade status</p>
            <p className="font-semibold text-slate-900">{dispute.trade?.status ?? 'unknown'}</p>
          </div>
          <div className="sm:col-span-2 rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Trade</p>
            <p className="truncate font-mono text-xs text-slate-600">{dispute.trade?._id ?? '—'}</p>
          </div>
        </div>
      </div>

      {(dispute.evidence ?? []).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(dispute.evidence ?? []).map((url, index) => (
            <a
              key={`${dispute._id}-evidence-${index}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-slate-50"
            >
              Evidence {index + 1}
            </a>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        {!expanded ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            Resolve dispute
          </button>
        ) : (
          <div className="space-y-4">
            <div>
              <label
                htmlFor={`resolution-${dispute._id}`}
                className="block text-xs font-semibold uppercase tracking-widest text-slate-500"
              >
                Resolution
              </label>
              <select
                id={`resolution-${dispute._id}`}
                value={resolution}
                onChange={(event) => {
                  setResolution(event.target.value as DisputeResolution | '');
                  setFormError(null);
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none sm:max-w-md"
              >
                <option value="">Select a resolution…</option>
                {RESOLUTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
            </div>

            {resolution === 'split' && (
              <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
                <div>
                  <label
                    htmlFor={`buyer-${dispute._id}`}
                    className="block text-xs font-semibold uppercase tracking-widest text-slate-500"
                  >
                    Buyer amount (KES)
                  </label>
                  <input
                    id={`buyer-${dispute._id}`}
                    type="number"
                    min={0}
                    step="1"
                    inputMode="numeric"
                    value={buyerAmount}
                    onChange={(event) => {
                      setBuyerAmount(event.target.value);
                      setFormError(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`seller-${dispute._id}`}
                    className="block text-xs font-semibold uppercase tracking-widest text-slate-500"
                  >
                    Seller amount (KES)
                  </label>
                  <input
                    id={`seller-${dispute._id}`}
                    type="number"
                    min={0}
                    step="1"
                    inputMode="numeric"
                    value={sellerAmount}
                    onChange={(event) => {
                      setSellerAmount(event.target.value);
                      setFormError(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                {splitRemainder !== null && (
                  <p
                    className={`sm:col-span-2 text-xs ${
                      splitRemainder === 0 ? 'text-emerald-600' : 'text-amber-600'
                    }`}
                  >
                    {splitRemainder === 0
                      ? 'Amounts add up to the escrowed deposit.'
                      : splitRemainder > 0
                        ? `${formatKES(splitRemainder)} still unallocated.`
                        : `${formatKES(Math.abs(splitRemainder))} over the escrowed deposit.`}
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor={`notes-${dispute._id}`}
                className="block text-xs font-semibold uppercase tracking-widest text-slate-500"
              >
                Admin notes (optional)
              </label>
              <textarea
                id={`notes-${dispute._id}`}
                rows={2}
                value={adminNotes}
                onChange={(event) => setAdminNotes(event.target.value)}
                placeholder="Reasoning recorded on the dispute…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {formError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {submitting ? 'Resolving...' : 'Confirm resolution'}
              </button>
              <button
                type="button"
                onClick={onToggle}
                disabled={submitting}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
