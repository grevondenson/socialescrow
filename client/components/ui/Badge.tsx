import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { Tone } from '../../lib/status';

const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  progress: 'bg-forest-50 text-forest-700 border-forest-200',
  success: 'bg-mint text-forest-700 border-forest-200',
  warning: 'bg-ochre-50 text-ochre-600 border-ochre-200',
  danger: 'bg-clay-50 text-clay-600 border-clay-200',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  progress: 'bg-forest',
  success: 'bg-forest',
  warning: 'bg-ochre',
  danger: 'bg-clay',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  /** A dot is cheaper than a second colour on low-end LCDs, and reads in greyscale. */
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}
