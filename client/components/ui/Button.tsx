'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders a spinner, disables the button, and keeps the label for screen readers. */
  isPending?: boolean;
  /** Label to show while pending. Defaults to keeping the current children. */
  pendingLabel?: string;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-forest text-white border border-transparent hover:bg-forest-800 active:bg-forest-900 shadow-sm',
  secondary:
    'bg-white text-ink border border-neutral-300 hover:bg-neutral-50 hover:border-neutral-400 active:bg-neutral-100',
  ghost:
    'bg-transparent text-forest border border-transparent hover:bg-forest-50 active:bg-forest-100',
  destructive:
    'bg-clay text-white border border-transparent hover:bg-clay-600 active:bg-clay-600 shadow-sm',
};

const SIZES: Record<Size, string> = {
  // 44px minimum on the default and large sizes: fat-finger safe on cheap Android screens.
  sm: 'h-10 px-3.5 text-sm gap-1.5 rounded-control',
  md: 'h-11 min-h-[44px] px-5 text-sm gap-2 rounded-control',
  lg: 'h-12 min-h-[44px] px-6 text-base gap-2 rounded-control',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isPending = false,
    pendingLabel,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {isPending && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
      {isPending && pendingLabel ? pendingLabel : children}
    </button>
  );
});
