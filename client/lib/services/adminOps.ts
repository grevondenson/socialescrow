import { api } from '../api';

/**
 * Phase 7 money-path admin operations: seller payouts and trade disputes.
 *
 * Envelope note — these two endpoints do NOT share a response shape:
 *   GET /admin/payouts  -> { data: PayoutQueue[], meta: { total, page, per_page } }
 *   GET /admin/disputes -> { disputes: Dispute[], pagination: { total, page, limit, pages } }
 * `getDisputes` in admin.controller.js predates the {data,meta} convention used by the
 * payouts/fraud-flag queues, so the types below mirror each controller exactly.
 */

// ── Payouts ──────────────────────────────────────────────────

export type PayoutStatus =
  | 'pending_approval'
  | 'approved'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'cancelled';

export const PAYOUT_STATUSES: PayoutStatus[] = [
  'pending_approval',
  'approved',
  'processing',
  'sent',
  'failed',
  'cancelled',
];

export interface PayoutTradeSummary {
  _id: string;
  amountKes: number;
  status: string;
}

export interface PayoutSellerSummary {
  _id: string;
  fullName?: string;
  email?: string;
  phone?: string;
}

export interface PayoutQueueItem {
  _id: string;
  // Populated, so a deleted trade/seller resolves to null — never assume presence.
  trade: PayoutTradeSummary | null;
  seller: PayoutSellerSummary | null;
  amountKes: number;
  status: PayoutStatus;
  approvedAt?: string | null;
  sentAt?: string | null;
  lastError?: string | null;
  createdAt: string;
}

export interface PayoutsPage {
  data: PayoutQueueItem[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

export async function fetchPayoutQueue(params: {
  status?: PayoutStatus;
  page?: number;
  per_page?: number;
} = {}): Promise<PayoutsPage> {
  const { data } = await api.get('/admin/payouts', {
    params: {
      // undefined params are dropped by axios, which is what "all statuses" wants.
      status: params.status,
      page: params.page,
      per_page: params.per_page,
    },
  });
  return data as PayoutsPage;
}

/** Only valid while the payout sits at `pending_approval`; anything else is a 409. */
export async function approvePayout(id: string): Promise<PayoutQueueItem> {
  const { data } = await api.patch(`/admin/payouts/${id}/approve`);
  return data?.data as PayoutQueueItem;
}

/** Valid from `pending_approval` or `approved`. The seller is still owed the money. */
export async function rejectPayout(id: string, reason?: string): Promise<PayoutQueueItem> {
  const { data } = await api.patch(`/admin/payouts/${id}/reject`, { reason });
  return data?.data as PayoutQueueItem;
}

/**
 * Valid from `cancelled` ONLY. The backend deliberately refuses `failed` payouts here:
 * a timeout is not proof Daraja did not pay out, so those need a Transaction Status query.
 */
export async function requeuePayout(id: string, reason?: string): Promise<PayoutQueueItem> {
  const { data } = await api.patch(`/admin/payouts/${id}/requeue`, { reason });
  return data?.data as PayoutQueueItem;
}

// ── Disputes ─────────────────────────────────────────────────

export type DisputeStatus = 'open' | 'under_review' | 'resolved';
export type DisputeResolution = 'release_to_seller' | 'refund_to_buyer' | 'split';

export interface DisputeTradeSummary {
  _id: string;
  amountKes: number;
  status: string;
  buyer?: string;
  seller?: string;
}

export interface DisputeRaisedBy {
  _id: string;
  fullName?: string;
  email?: string;
}

export interface DisputeItem {
  _id: string;
  trade: DisputeTradeSummary | null;
  raisedBy: DisputeRaisedBy | null;
  reason: string;
  evidence?: string[];
  status: DisputeStatus;
  resolution?: DisputeResolution | null;
  resolvedAt?: string | null;
  adminNotes?: string | null;
  createdAt: string;
}

export interface DisputesPage {
  disputes: DisputeItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export async function fetchDisputes(params: { page?: number; limit?: number } = {}): Promise<DisputesPage> {
  const { data } = await api.get('/admin/disputes', {
    params: { page: params.page, limit: params.limit },
  });
  return data as DisputesPage;
}

export interface ResolveDisputePayload {
  resolution: DisputeResolution;
  /** Required (and must sum to trade.amountKes) when resolution === 'split'. */
  buyerAmount?: number;
  sellerAmount?: number;
  adminNotes?: string;
}

export async function resolveDispute(id: string, payload: ResolveDisputePayload): Promise<DisputeItem> {
  const { data } = await api.patch(`/admin/disputes/${id}/resolve`, payload);
  return data as DisputeItem;
}

// ── Shared ───────────────────────────────────────────────────

/** Surface the server's `message` rather than axios's generic status-code text. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  const err = error as {
    response?: { data?: { message?: string } };
    message?: string;
  } | null;
  return err?.response?.data?.message ?? err?.message ?? fallback;
}
