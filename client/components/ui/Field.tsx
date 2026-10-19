import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Field is the label/hint/error wrapper. Controls never carry their own label:
 * a placeholder-only input is unusable the moment the user starts typing and
 * invisible to screen readers, so every control goes through here.
 */

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-1 text-clay" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-4 text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs leading-4 font-medium text-clay-600">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-control border bg-white px-3.5 text-sm text-ink placeholder:text-neutral-400 ' +
  'transition-colors duration-150 min-h-[44px] ' +
  'focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-forest/30 focus:border-forest ' +
  'disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500';

const CONTROL_STATE = {
  normal: 'border-neutral-300 hover:border-neutral-400',
  invalid: 'border-clay-300 bg-clay-50/40',
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  describedBy?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, describedBy, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(CONTROL_BASE, invalid ? CONTROL_STATE.invalid : CONTROL_STATE.normal, className)}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  describedBy?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, describedBy, rows = 3, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        CONTROL_BASE,
        'py-2.5 leading-6',
        invalid ? CONTROL_STATE.invalid : CONTROL_STATE.normal,
        className
      )}
      {...props}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  describedBy?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid = false, describedBy, children, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      // The chevron is an inline style rather than a CSS class: an inlined SVG data URI in
      // globals.css gets picked up by css-loader's url() resolution and fails to compile.
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%236B7668' stroke-width='1.5'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.75rem center',
        backgroundSize: '16px 16px',
      }}
      className={cn(
        CONTROL_BASE,
        'appearance-none pr-9',
        invalid ? CONTROL_STATE.invalid : CONTROL_STATE.normal,
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});

/** Convenience: generates the id and wires label/control together. */
export function useFieldId(prefix: string) {
  const id = useId();
  return `${prefix}-${id.replace(/:/g, '')}`;
}
