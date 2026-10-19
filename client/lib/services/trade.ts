import { api } from '../api';

/**
 * Trade room data layer.
 *
 * Shapes mirror server/src/controllers/trades.controller.js exactly. Two fields are
 * computed by the controller rather than stored: `hasVaultCredentials` and `vaultRevealed`.
 *
 * The `res.json(trade)` responses are envelope-less (bare documents), unlike the Phase 7
 * admin endpoints — do not "normalise" this without changing the server too.
 */

export type TradeStatus =
  | 'pending'
  | 'payment_window'
  | 'paid'
  | 'credentials_released'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface TradeParty {
  _id: string;
  // The controller populates 'fullName email kycVerified'. Note: the old code read
  // `.name`, which does not exist on the User model, so party names were always blank.
  fullName?: string;
  email?: string;
  kycVerified?: boolean;
}

export interface TradeListing {
  _id: string;
  platform?: string;
  niche?: string;
  followers?: number;
  engagementRate?: string;
  description?: string;
  priceKes?: number;
  proofScreenshots?: string[];
}

export interface TradeManualPayment {
  status: string;
  referenceCode?: string;
  submittedAt?: string;
  notes?: string;
}

export interface TradePayout {
  _id: string;
  status: 'pending_approval' | 'approved' | 'processing' | 'sent' | 'failed' | 'cancelled';
  amountKes: number;
  queuedAt?: string | null;
  approvedAt?: string | null;
  sentAt?: string | null;
  lastError?: string | null;
}

export interface Trade {
  _id: string;
  listing: TradeListing | null;
  buyer: TradeParty;
  seller: TradeParty;
  amountKes: number;
  platformFeeKes: number;
  sellerPayoutKes: number;
  status: TradeStatus;
  paymentWindowExpires?: string | null;
  confirmWindowExpires?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Virtual, added by getTrade. */
  hasVaultCredentials?: boolean;
  vaultRevealed?: boolean;
  /** Set by getTrade once the vault has been revealed (not stored on Trade). */
  vaultRevealedAt?: string | null;
  /** Null unless a manual payment is awaiting admin verification. */
  manualPayment?: TradeManualPayment | null;
  /** Seller-only payout state, added by GET /trades/:id/payout. */
  payout?: TradePayout | null;
}

export interface TradeMessage {
  _id: string;
  trade: string;
  sender: TradeParty | string;
  type: 'text' | 'image' | 'system';
  content: string;
  imageUrl?: string;
  createdAt: string;
}

export const fetchTrade = (id: string): Promise<Trade> =>
  api.get(`/trades/${id}`).then((r) => r.data);

export const fetchTradeMessages = (id: string): Promise<TradeMessage[]> =>
  api.get(`/trades/${id}/messages`).then((r) => r.data);

export const sendTradeMessage = (id: string, content: string): Promise<TradeMessage> =>
  api.post(`/trades/${id}/messages`, { content }).then((r) => r.data);

export const raiseTradeDispute = (id: string, reason: string) =>
  api.post(`/trades/${id}/dispute`, { reason }).then((r) => r.data);

export const revealCredentials = (id: string): Promise<{ credentials: string }> =>
  api.get(`/trades/${id}/vault/reveal`).then((r) => r.data);

export const submitCredentials = (id: string, credentials: string) =>
  api.post(`/trades/${id}/vault`, { credentials }).then((r) => r.data);

export const releaseCredentials = (id: string) =>
  api.patch(`/trades/${id}/release`).then((r) => r.data);

export const confirmReceipt = (id: string) =>
  api.patch(`/trades/${id}/confirm`).then((r) => r.data);

export const triggerStkPush = (id: string, phoneNumber: string) =>
  api.post('/mpesa/stk-push', { tradeId: id, phoneNumber }).then((r) => r.data);

export const submitManualPayment = (
  id: string,
  payload: { referenceCode: string; phoneNumber: string }
) => api.post('/mpesa/manual-payment', { tradeId: id, ...payload }).then((r) => r.data);

/** Seller-facing payout state for one trade. */
export const fetchTradePayout = (id: string): Promise<TradePayout | null> =>
  api.get(`/trades/${id}/payout`).then((r) => r.data);

/** Surface the server's `message`, and the 403 `action` hint used by the verify-email gate. */
export function tradeErrorMessage(error: unknown, fallback: string): string {
  const err = error as {
    response?: { data?: { message?: string; action?: string } };
    message?: string;
  } | null;
  return err?.response?.data?.message ?? err?.message ?? fallback;
}

/** True when the backend refused because the account has not verified its email. */
export function isVerifyEmailError(error: unknown): boolean {
  const err = error as { response?: { status?: number; data?: { action?: string } } } | null;
  return err?.response?.status === 403 && err?.response?.data?.action === 'verify_email';
}
