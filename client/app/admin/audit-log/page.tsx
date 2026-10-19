'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAuditLog,
  humanizeAction,
  auditActorLabel,
  actorIdOf,
  errorMessage,
  type AuditLogEntry,
} from '../../../lib/services/risk';

// ── Action grouping ────────────────────────────────────────────────────────────
//
// Audit actions are not a single vocabulary: Phase 1–3 wrote SCREAMING_CASE enum
// names (VAULT_SUBMIT, VAULT_DOUBLE_REVEAL) while Phase 7 controllers write
// snake_case (payout_approved). Both are shown, but the badge tone differs so the
// vault/security lineage is visually distinct from routine admin activity.

const isLegacyAction = (action: string): boolean =>
  Boolean(action) && action === action.toUpperCase() && /[A-Z]/.test(action);

const SECURITY_ACTIONS = new Set([
  'VAULT_SUBMIT',
  'VAULT_REVEAL',
  'VAULT_REVEAL_ATTEMPT_FAILED',
  'login_failure',
  'kyc_mismatch',
  'platform_circuit_breaker',
]);

const actionTone = (action: string): string => {
  if (SECURITY_ACTIONS.has(action)) {
    return 'bg-orange-50 text-orange-700 border-orange-200';
  }
  if (isLegacyAction(action)) {
    return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

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
    second: '2-digit',
  });
};

const metadataEntries = (metadata?: Record<string, unknown> | null): [string, unknown][] => {
  if (!metadata || typeof metadata !== 'object') return [];
  return Object.entries(metadata);
};

/** Renders scalars inline and objects/arrays as compact JSON. */
const renderMetadataValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const PAGE_SIZE = 50;

function MetadataPanel({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const entries = metadataEntries(entry.metadata);
  const hasMetadata = entries.length > 0;

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:text-slate-900"
        aria-expanded={open}
      >
        <span>
          Metadata
          {hasMetadata && (
            <span className="ml-1.5 font-normal text-slate-400">({entries.length} field{entries.length === 1 ? '' : 's'})</span>
          )}
        </span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-3 py-2">
          {hasMetadata ? (
            <>
              <dl className="grid gap-1.5 sm:grid-cols-2">
                {entries.map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="truncate font-mono text-[11px] text-slate-400">{key}</dt>
                    <dd className="break-all font-mono text-xs text-slate-700">
                      {renderMetadataValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                {JSON.stringify(entry.metadata ?? {}, null, 2)}
              </pre>
            </>
          ) : (
            <p className="text-xs text-slate-400">No metadata recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminAuditLogPage() {
  const [page, setPage] = useState(1);

  // Envelope is { logs, pagination } here — not { data, meta } like the other
  // admin list endpoints. `pagination.pages` is the server's own page count.
  const query = useQuery({
    queryKey: ['admin', 'audit-log', page],
    queryFn: () => fetchAuditLog(page, PAGE_SIZE),
    refetchOnWindowFocus: false,
  });

  const logs = query.data?.logs ?? [];
  const pagination = query.data?.pagination;
  const totalPages = pagination?.pages ?? 1;
  const total = pagination?.total ?? 0;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Audit Log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every privileged action, newest first — vault reveals, KYC decisions, payouts, and dispute resolutions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-slate-500">
            {query.isFetching ? 'Refreshing…' : `${total.toLocaleString('en-KE')} entries`}
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {query.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      )}

      {query.isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {errorMessage(query.error, 'Failed to load audit log.')}
        </div>
      )}

      {!query.isLoading && !query.isError && logs.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No audit entries yet.
        </div>
      )}

      {!query.isLoading && !query.isError && logs.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">IP</th>
                <th className="px-4 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((entry) => {
                const actor = auditActorLabel(entry);
                const actorId = actorIdOf(entry);
                return (
                  <tr key={entry._id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${actionTone(entry.action)}`}
                          title={entry.action}
                        >
                          {humanizeAction(entry.action)}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">{entry.action}</span>
                        {entry.flagged && (
                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            Flagged
                          </span>
                        )}
                      </div>
                      <MetadataPanel entry={entry} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{actor}</p>
                      {actorId && (
                        <p className="font-mono text-[11px] text-slate-400">{actorId}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {entry.ip || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {formatDate(entry.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
            Page {pagination?.page ?? page} of {totalPages}
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
