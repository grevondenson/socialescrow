import { api } from '../api';

export interface WalletData {
  _id: string;
  user: string;
  availableBalance: number;
  lockedInEscrow: number;
  pendingPayout: number;
  totalDeposited: number;
  totalWithdrawn: number;
  currency: string;
  lastReconciledAt?: string;
  updatedAt: string;
}

export type LedgerEntryType =
  | 'DEPOSIT'
  | 'ESCROW_LOCK'
  | 'ESCROW_RELEASE'
  | 'PLATFORM_FEE'
  | 'SELLER_PAYOUT'
  | 'REFUND'
  | 'DISPUTE_HOLD';

export interface LedgerEntry {
  _id: string;
  trade?: string;
  user: string;
  type: LedgerEntryType;
  amountKes: number;
  balanceBefore: number;
  balanceAfter: number;
  reference?: string;
  note?: string;
  createdAt: string;
}

export interface LedgerPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface LedgerHistoryResponse {
  entries: LedgerEntry[];
  pagination: LedgerPagination;
}

export const fetchWallet = (): Promise<WalletData> =>
  api.get('/wallet').then((r) => r.data);

export const fetchLedger = (
  page: number,
  limit: number,
  type?: LedgerEntryType
): Promise<LedgerHistoryResponse> =>
  api
    .get('/wallet/ledger', { params: { page, limit, ...(type ? { type } : {}) } })
    .then((r) => r.data);

export const reconcileWallet = () =>
  api.get('/wallet/reconcile').then((r) => r.data);
