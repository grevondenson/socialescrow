import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Empty and error states.
 *
 * Both are moments for direction, not mood: the empty state says what would fill it,
 * the error says what broke and what to try. Neither apologises.
 */

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-neutral-300 bg-white text-center',
        compact ? 'px-6 py-8' : 'px-6 py-14'
      )}
    >
      <Inbox className="h-8 w-8 text-neutral-300" aria-hidden="true" />
      <p className="mt-3 font-display text-base font-semibold text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-5 text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'This did not load',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-card border border-clay-200 bg-clay-50 px-6 py-12 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-clay" aria-hidden="true" />
      <p className="mt-3 font-display text-base font-semibold text-clay-600">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-5 text-clay-600/90">
        {description ?? 'Check your connection and try again. If it keeps failing, the server may be down.'}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-control border border-clay-300 bg-white px-4 py-2 text-sm font-medium text-clay-600 hover:bg-clay-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-neutral-200/80', className)}
    />
  );
}
