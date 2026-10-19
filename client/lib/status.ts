/**
 * Domain status vocabulary.
 *
 * Before this file every surface invented its own presentation of the same enums:
 * `trade.status.replace(/_/g, ' ')` in the trade room, a per-page `STATUS_STYLES` map
 * in disputes, a different `STATUS_STYLES` in payouts, plain strings in listings. The
 * same `payment_window` could render four ways on four screens.
 *
 * One map, keyed by domain, consumed by <Badge> and <StatusRail>.
 */

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** Shown under the label where there is room — admin tables and the status rail. */
  hint?: string;
}

type StatusMap = Record<string, StatusMeta>;

const fallback = (value: string): StatusMeta => ({
  label: humanize(value),
  tone: 'neutral',
});

/** `payment_window` -> "Payment window"; `NEW_ACCOUNT_HIGH_VALUE` -> "New account high value". */
export function humanize(value: string): string {
  if (!value) return 'Unknown';
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Trade ──────────────────────────────────────────────────────────────────────
// Mirrors Trade.status: pending | payment_window | paid | credentials_released |
// completed | disputed | cancelled.

export const TRADE_STATUS: StatusMap = {
  pending: { label: 'Awaiting payment', tone: 'neutral', hint: 'The trade exists but nothing has been paid yet.' },
  payment_window: { label: 'Awaiting payment', tone: 'warning', hint: 'M-Pesa payment is open. Funds are not yet in escrow.' },
  paid: { label: 'In escrow', tone: 'progress', hint: 'Funds are locked. The seller is preparing the account.' },
  credentials_released: { label: 'Credentials released', tone: 'progress', hint: 'Reveal once, then confirm receipt to release the money.' },
  completed: { label: 'Completed', tone: 'success', hint: 'Money released and the trade is closed.' },
  disputed: { label: 'In dispute', tone: 'danger', hint: 'Funds are frozen until an admin resolves the case.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', hint: 'The payment window passed without a payment.' },
};

// ── Payout ─────────────────────────────────────────────────────────────────────
// Mirrors PayoutQueue.status.

export const PAYOUT_STATUS: StatusMap = {
  pending_approval: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'progress' },
  processing: { label: 'Sending', tone: 'progress' },
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

// ── Dispute ────────────────────────────────────────────────────────────────────

export const DISPUTE_STATUS: StatusMap = {
  open: { label: 'Open', tone: 'warning' },
  under_review: { label: 'Under review', tone: 'progress' },
  resolved: { label: 'Resolved', tone: 'success' },
};

// ── Listing ────────────────────────────────────────────────────────────────────
// Not every listing status is public — pending_review is admin-only.

export const LISTING_STATUS: StatusMap = {
  pending_review: { label: 'Pending review', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  in_trade: { label: 'In trade', tone: 'progress' },
  sold: { label: 'Sold', tone: 'neutral' },
  removed: { label: 'Removed', tone: 'danger' },
};

// ── KYC ────────────────────────────────────────────────────────────────────────

export const KYC_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  mismatch: { label: 'Name mismatch', tone: 'danger' },
};

// ── Seller tier ────────────────────────────────────────────────────────────────
// ⚠️ Nothing in the backend writes User.sellerTier yet (reputation.service.js is absent),
// so every seller currently renders as `none`. The map exists so the UI is ready when it is.

export const SELLER_TIER: StatusMap = {
  none: { label: 'New seller', tone: 'neutral' },
  verified: { label: 'Verified', tone: 'success' },
  trusted: { label: 'Trusted seller', tone: 'progress' },
  top_seller: { label: 'Top seller', tone: 'success' },
};

// ── Risk ───────────────────────────────────────────────────────────────────────

export const RISK_LEVEL: StatusMap = {
  low: { label: 'Low', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'warning' },
  high: { label: 'High', tone: 'danger' },
  blocked: { label: 'Blocked', tone: 'danger' },
};

/** Look a status up, falling back to a humanized neutral badge for unknown values. */
export function statusMeta(map: StatusMap, value?: string | null): StatusMeta {
  if (!value) return { label: 'Unknown', tone: 'neutral' };
  return map[value] ?? fallback(value);
}
