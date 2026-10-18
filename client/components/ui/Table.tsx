import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Table primitives.
 *
 * Every admin page reimplemented its own <table> markup with slightly different
 * padding and hover behaviour. These components own the chrome; pages own the rows.
 * Tables scroll horizontally on mobile rather than squeezing columns — admin screens
 * carry money and IDs, and truncated figures are worse than a swipe.
 */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <div className="inline-block min-w-full px-5 align-middle sm:px-6">
        <table className={cn('min-w-full border-collapse text-left text-sm', className)}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-neutral-200">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-neutral-100">{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'align-middle transition-colors duration-100',
        onClick && 'cursor-pointer hover:bg-neutral-50',
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  numeric = false,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-neutral-500',
        numeric && 'text-right',
        className
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  numeric = false,
  className,
  colSpan,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-3 py-3 text-neutral-700',
        numeric && 'tnum text-right',
        className
      )}
    >
      {children}
    </td>
  );
}

/** Full-width placeholder row, so a table never collapses to an empty header bar. */
export function TEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-sm text-neutral-500">
        {children}
      </td>
    </tr>
  );
}
