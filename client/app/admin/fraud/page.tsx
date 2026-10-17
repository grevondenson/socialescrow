'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchFraudFlags,
  humanizeFlagType,
  shortId,
  errorMessage,
  type FraudFlag,
  type FraudRiskLevel,
} from '../../../lib/services/risk';

// ── Filter vocabularies ────────────────────────────────────────────────────────
//
// `resolved` is tri-state on the API: omitted means "all", so "all" must not send
// the param at all (sending `resolved=` would make the controller compare against
// the empty string and match nothing).

type ResolvedFilter = 'all' | 'unresolved' | 'resolved';

const RESOLVED_OPTIONS: { value: ResolvedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'resolved', label: 'Resolved' },
];

const RISK_LEVELS: FraudRiskLevel[] = ['low', 'medium', 'high', 'blocked'];

// Low/medium/high/blocked map onto the same slate/amber/red ramp the rest of the
// admin screens use, so a blocked flag is unmistakable at a glance.
const RISK_BADGE: Record<FraudRiskLevel, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
};

const RISK_DOT: Record<FraudRiskLevel, string> = {
  low: 'bg-slate-400',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  blocked: 'bg-red-600',
};

const riskBadgeClass = (level: FraudRiskLevel): string =>
  RISK_BADGE[level] ?? RISK_BADGE.low;

const riskDotClass = (level: FraudRiskLevel): string =>
  RISK_DOT[level] ?? RISK_DOT.low;

const formatDate = (value?: string): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatAmount = (amount?: number): string =>
  typeof amount === 'number' ? `KES ${amount.toLocaleString('en-KE')}` : '—';

interface PopulatedUser {
  _id: string;
  fullName?: string;
  email?: string;
}

const userLabel = (flag: FraudFlag): { name: string; email?: string } => {
  if (!flag.user) return { name: 'Unknown user' };
  if (typeof flag.user === 'string') return { name: flag.user };
  const u = flag.user as PopulatedUser;
  return { name: u.fullName || u.email || u._id, email: u.fullName ? u.email : undefined };
};

const tradeInfo = (flag: FraudFlag): { id: string; amount?: number; status?: string } | null => {
  if (!flag.trade) return null;
  if (typeof flag.trade === 'string') return { id: flag.trade };
  return { id: flag.trade._id, amount: flag.trade.amountKes, status: flag.trade.status };
};

export default function AdminFraudPage() {
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>('unresolved');
  const [riskFilter, setRiskFilter] = useState<FraudRiskLevel | 'all'>('all');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const query = useQuery({
    queryKey: ['admin', 'fraud-flags', resolvedFilter, riskFilter, page],
    queryFn: () =>
      fetchFraudFlags({
        resolved:
          resolvedFilter === 'all' ? undefined : resolvedFilter === 'resolved',
        riskLevel: riskFilter === 'all' ? undefined : riskFilter,
        page,
        perPage,
      }),
    refetchOnWindowFocus: false,
  });

  // Memoized so its identity only changes when the query result does — otherwise the
  // `?? []` fallback creates a new array every render and defeats pageCounts' useMemo.
  const flags = useMemo(() => query.data?.data ?? [], [query.data]);
  const meta = query.data?.meta;
  const total = meta?.total ?? 0;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / (meta.per_page || perPage))) : 1;

  // Counts for the header chips are derived from the page of results we already
  // have. They are page-local on purpose — the API exposes no aggregate endpoint,
  // and inventing per-level totals from a filtered response would be wrong.
  const pageCounts = useMemo(() => {
    const counts: Record<FraudRiskLevel, number> = { low: 0, medium: 0, high: 0, blocked: 0 };
    for (const flag of flags) {
      if (flag.riskLevel in counts) counts[flag.riskLevel] += 1;
    }
    return counts;
  }, [flags]);

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setPage(1);
    setter(value);
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Fraud Flags</h1>
          <p className="mt-1 text-sm text-slate-500">
            Risk signals raised by vault verification, webhook reconciliation, and account heuristics.
          </p>
        </div>
        <p className="text-sm text-slate-500">
          {query.isFetching ? 'Refreshing…' : `${total} flag${total === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</span>
          {RESOLVED_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => resetPage(setResolvedFilter)(option.value)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                resolvedFilter === option.value
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Risk</span>
          <button
            type="button"
            onClick={() => resetPage(setRiskFilter)('all')}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
              riskFilter === 'all'
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            All
          </button>
          {RISK_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => resetPage(setRiskFilter)(level)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-medium capitalize transition ${
                riskFilter === level
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-500">
        {RISK_LEVELS.map((level) => (
          <span key={level} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
            <span className={`h-2 w-2 rounded-full ${riskDotClass(level)}`} />
            <span className="capitalize">{level}</span>
            <span className="font-semibold text-slate-700">{pageCounts[level]}</span>
          </span>
        ))}
        <span className="px-1 py-1 text-slate-400">on this page</span>
      </div>

      {query.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      )}

      {query.isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {errorMessage(query.error, 'Failed to load fraud flags.')}
        </div>
      )}

      {!query.isLoading && !query.isError && flags.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No flags match these filters. That is the good outcome.
        </div>
      )}

      {!query.isLoading && !query.isError && flags.length > 0 && (
        <div className="space-y-4">
          {flags.map((flag) => {
            const actor = userLabel(flag);
            const trade = tradeInfo(flag);
            return (
              <article
                key={flag._id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${riskBadgeClass(flag.riskLevel)}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${riskDotClass(flag.riskLevel)}`} />
                        {flag.riskLevel}
                      </span>
                      <h2 className="text-base font-semibold text-slate-900">
                        {humanizeFlagType(flag.flagType)}
                      </h2>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-500">
                        {flag.flagType}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-slate-600">
                      <span className="font-medium text-slate-900">{actor.name}</span>
                      {actor.email && <span className="text-slate-500"> · {actor.email}</span>}
                    </p>
                  </div>

                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    {flag.resolved ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        Resolved
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        Open
                      </span>
                    )}
                    <span className="font-mono text-xs text-slate-400">#{shortId(flag._id)}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Risk score</p>
                    <p className="mt-1 font-semibold text-slate-900">{flag.riskScore}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Trade</p>
                    <p className="mt-1 text-slate-900">
                      {trade ? (
                        <>
                          {formatAmount(trade.amount)}
                          {trade.status && (
                            <span className="ml-1 text-xs capitalize text-slate-500">· {trade.status}</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Trade ref</p>
                    <p className="mt-1 font-mono text-xs text-slate-600">
                      {trade ? shortId(trade.id) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Flagged</p>
                    <p className="mt-1 text-slate-900">{formatDate(flag.createdAt)}</p>
                  </div>
                </div>

                {flag.note && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">Note: </span>
                    {flag.note}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {!query.isLoading && !query.isError && totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-sm text-slate-500">
            Page {meta?.page ?? page} of {totalPages}
          </p>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
