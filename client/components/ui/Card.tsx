import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the default padding when the card wraps a full-bleed table. */
  flush?: boolean;
}

export function Card({ className, flush = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-neutral-200 bg-white shadow-card',
        !flush && 'p-5 sm:p-6',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-5 text-neutral-600">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A labelled figure. Used for wallet balances, queue counts, platform totals.
 * The unit lives in the label, never appended to the number — "In escrow / KES 15,000"
 * scans faster than "KES 15,000 in escrow" repeated five times down a column.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'forest' | 'ochre' | 'clay';
}) {
  const dot = {
    neutral: 'bg-neutral-400',
    forest: 'bg-forest',
    ochre: 'bg-ochre',
    clay: 'bg-clay',
  }[tone];

  return (
    <div className="rounded-card border border-neutral-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
          {label}
        </p>
      </div>
      <p className="tnum mt-2 font-display text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs leading-4 text-neutral-500">{hint}</p>}
    </div>
  );
}
