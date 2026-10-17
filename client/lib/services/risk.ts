import { api } from '../api';

// ── Fraud flags ────────────────────────────────────────────────────────────────
//
// GET /admin/fraud-flags -> { data: FraudFlag[], meta: { total, page, per_page } }
// The controller refuses an unknown riskLevel with 400 INVALID_RISK_LEVEL, so the
// client only ever sends one of the four enum values (or omits the param).

export type FraudRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export type FraudFlagType =
  | 'NEW_ACCOUNT_HIGH_VALUE'
  | 'MULTIPLE_DISPUTES'
  | 'DUPLICATE_PHONE'
  | 'IP_MISMATCH'
  | 'RAPID_LISTINGS'
  | 'SUSPICIOUS_CANCEL'
  | 'WEBHOOK_MISMATCH'
  | 'VAULT_DOUBLE_REVEAL'
  | 'RECONCILIATION_MISMATCH';

export interface FraudFlagUser {
  _id: string;
  fullName?: string;
  email?: string;
}

export interface FraudFlagTrade {
  _id: string;
  amountKes?: number;
  status?: string;
}

export interface FraudFlag {
  _id: string;
  user: FraudFlagUser | string | null;
  trade?: FraudFlagTrade | string | null;
  flagType: FraudFlagType | string;
  riskScore: number;
  riskLevel: FraudRiskLevel;
  resolved: boolean;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface FraudFlagMeta {
  total: number;
  page: number;
  per_page: number;
}

export interface FraudFlagResponse {
  data: FraudFlag[];
  meta: FraudFlagMeta;
}

export interface FraudFlagQuery {
  /** Omit for "all". The API only filters when the param is present. */
  resolved?: boolean;
  riskLevel?: FraudRiskLevel;
  page?: number;
  perPage?: number;
}

export const fetchFraudFlags = (query: FraudFlagQuery = {}): Promise<FraudFlagResponse> => {
  const params: Record<string, string | number> = {};
  if (query.resolved !== undefined) params.resolved = String(query.resolved);
  if (query.riskLevel) params.riskLevel = query.riskLevel;
  if (query.page) params.page = query.page;
  if (query.perPage) params.per_page = query.perPage;

  return api.get('/admin/fraud-flags', { params }).then((r) => r.data);
};

// ── Audit log ──────────────────────────────────────────────────────────────────
//
// GET /admin/audit-log -> { logs: AuditLog[], pagination: { total, page, limit, pages } }
// NOTE: different envelope from the fraud/payout endpoints — { logs, pagination }.

export interface AuditActor {
  _id: string;
  fullName?: string;
  email?: string;
}

export interface AuditLogEntry {
  _id: string;
  action: string;
  /**
   * The schema field is `user`, but several controllers write `userId` and
   * getAuditLogs populates `userId`. Read both so the actor renders whichever
   * the API actually returns.
   */
  user?: AuditActor | string | null;
  userId?: AuditActor | string | null;
  ip?: string;
  userAgent?: string;
  flagged?: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AuditLogResponse {
  logs: AuditLogEntry[];
  pagination: AuditLogPagination;
}

export const fetchAuditLog = (page = 1, limit = 50): Promise<AuditLogResponse> =>
  api.get('/admin/audit-log', { params: { page, limit } }).then((r) => r.data);

// ── Presentation helpers ───────────────────────────────────────────────────────

/**
 * Turns enum-style actions into sentences: `VAULT_SUBMIT` -> "Vault submit",
 * `payout_approved` -> "Payout approved". Older Phase 2/3 actions are SCREAMING_CASE
 * enum names, newer ones are snake_case — both read the same after this.
 */
export const humanizeAction = (action: string): string => {
  if (!action) return 'Unknown action';
  const spaced = action.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** `NEW_ACCOUNT_HIGH_VALUE` -> "New account high value". */
export const humanizeFlagType = (flagType: string): string => humanizeAction(flagType);

/** Best-effort actor label from either audit-log shape. */
export const auditActorLabel = (entry: AuditLogEntry): string => {
  const actor = entry.user ?? entry.userId ?? null;
  if (!actor) return 'System';
  if (typeof actor === 'string') return actor;
  return actor.fullName || actor.email || actor._id || 'Unknown';
};

/** Best-effort actor id from either audit-log shape. */
export const actorIdOf = (entry: AuditLogEntry): string | null => {
  const actor = entry.user ?? entry.userId ?? null;
  if (!actor) return null;
  return typeof actor === 'string' ? actor : actor._id;
};

/** Mongo ObjectId strings are not useful in a queue table — shorten them. */
export const shortId = (id?: string | null): string =>
  id ? `${id.slice(-6)}` : '—';

/** Pull a human message out of an axios error without leaking the whole object. */
export const errorMessage = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message || fallback;
};
