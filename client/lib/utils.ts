import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * KES formatting.
 *
 * `Intl` with `currency: 'KES'` renders "Ksh 15,000.00" in some engines and "Ksh15,000.00"
 * in others, and always adds cents that this product never uses (ADR 10: KES is stored as
 * integers). We format the integer ourselves and prefix deliberately.
 */
export function formatKES(amount: number | null | undefined) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return 'KES —';
  return `KES ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(amount)}`;
}

/** Bare grouped integer, no currency — for compact tiles where the label carries the unit. */
export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-KE').format(value);
}

/** "18 Oct 2026" */
export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

/** "18 Oct 2026, 14:03" */
export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** "in 4 min", "12 min ago" — for payment windows and audit trails. */
export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  const unit =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes} min`
        : hours < 24
          ? `${hours} hr`
          : `${days} day${days === 1 ? '' : 's'}`;

  if (unit === 'just now') return unit;
  return diff > 0 ? `in ${unit}` : `${unit} ago`;
}

/** Mongo ObjectIds are noise in a queue table. Last six characters are enough to point at one. */
export function shortId(id?: string | null) {
  return id ? `…${id.slice(-6)}` : '—';
}

/** mm:ss from a millisecond countdown — the credential wipe and payment window. */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
