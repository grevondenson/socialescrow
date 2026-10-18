'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Pagination.
 *
 * The admin endpoints disagree on their meta shape — payouts/fraud return
 * `{ total, page, per_page }`, disputes/audit return `{ total, page, limit, pages }` —
 * so this takes the already-normalised numbers rather than an envelope. Callers adapt.
 */
export function Pagination({
  page,
  perPage,
  total,
  onPageChange,
  label = 'results',
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col items-center justify-between gap-3 border-t border-neutral-100 pt-4 sm:flex-row"
    >
      <p className="tnum text-xs text-neutral-500">
        {from}–{to} of {total} {label}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={cn(
            'grid h-10 w-10 place-items-center rounded-control border border-neutral-300 text-neutral-600',
            'hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
          )}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="tnum px-3 text-sm text-neutral-600">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          className={cn(
            'grid h-10 w-10 place-items-center rounded-control border border-neutral-300 text-neutral-600',
            'hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
          )}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
