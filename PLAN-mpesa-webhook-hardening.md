# Plan: Harden M-Pesa Payment Webhooks (Phase 5 security)

> Status: **LOCKED** — implementation specifics resolved against code (2 Explore passes)
> and two design decisions confirmed. Ready to implement.
> Last updated: 12 Aug 2026.

## Context

Phase 5 introduced real money movement: M-Pesa (Daraja) STK Push, a manual-payment
fallback, and admin review. All confirmation paths converge on `_settleConfirmedPayment`
(`server/src/services/mpesa.service.js:122`), which credits the buyer's wallet, locks
escrow, and flips the trade to `paid`. Callers confirmed:
`processSTKCallback → _finalizeTransaction → _settleConfirmedPayment`;
`pollTransactionStatus → _finalizeTransaction → _settleConfirmedPayment`;
`verifyManualPayment → _settleConfirmedPayment`.

Three confirmed vulnerabilities:

1. **Unauthenticated, self-forgeable STK webhook.** `POST /api/mpesa/webhook/stk-push`
   and `POST /api/mpesa/webhook/kyc` have **no middleware** (`mpesa.routes.js:10-11`).
   `triggerStkPush` returns the full transaction incl. `checkoutRequestId` to the buyer
   (`mpesa.controller.js:13`). A buyer can read their own `CheckoutRequestID` and POST a
   fabricated `{ Body: { stkCallback: { ResultCode: 0, ... }}}` → settle a payment never
   made. Daraja callbacks are unsigned → source must be validated out-of-band.
2. **Paid amount never validated.** `_finalizeTransaction` extracts only
   `MpesaReceiptNumber` + `PhoneNumber` (`mpesa.service.js:155-157`); it never reads the
   `Amount` item. `_settleConfirmedPayment` credits `trade.amountKes` (`:131`). Manual
   payments capture no amount at all.
3. **No receipt/reference uniqueness → replay.** `mpesaReceiptNumber` and
   `manualPayment.referenceCode` have **no uniqueness** (`MpesaTransaction.model.js:14,20`;
   only `checkoutRequestId` is `unique+sparse` at `:6`). One real payment could settle
   multiple trades. Re-settlement is guarded only by mutable state
   (`status:'pending'` CAS at `:163`; `trade.status==='payment_window'` at `:125`) and the
   `EscrowRecord` E11000 backstop (`escrow.service.js:44`).

Intended outcome: a fabricated or replayed callback can no longer settle a trade.
Settlement requires (a) trusted source IP, (b) independent Daraja STK-Query confirm,
(c) paid amount == trade amount, (d) an unused receipt.

## Design corrections discovered during exploration

- **STK Query returns no amount.** The Daraja STK **Query** response
  (`/mpesa/stkpushquery/v1/query`, used by `pollTransactionStatus` at
  `mpesa.service.js:318`) carries only a `ResultCode` — no `CallbackMetadata`/`Amount`/
  `MpesaReceiptNumber`. So re-query is a **ResultCode-only anti-forgery gate**; the amount
  and receipt checks must key off the **callback body**, not the query.
- **`pollTransactionStatus` settles as a side effect** (calls `_finalizeTransaction` on
  `ResultCode 0`) → it is not a pure read. Refactor a pure `queryStkStatus()` out of it.
- **Happy-path settlement runs in a Mongo transaction** (`mpesa.service.js:304`) →
  settlement tests need `MongoMemoryReplSet` (count 1); the existing standalone
  `MongoMemoryServer` can't do multi-doc transactions.
- **`req.ip` is not the client IP.** No `app.set('trust proxy')` exists; Express 4.18
  behind Railway's edge proxy makes `req.ip` the proxy address. The allowlist is a no-op
  until trust proxy is enabled.

## Decisions (confirmed)

- **Manual-path amount:** Admin enters the **received amount** at verify time; settlement
  refuses if it != `trade.amountKes`. New `manualPayment.amountKes` field.
- **Client IP:** Enable **global** `app.set('trust proxy', TRUST_PROXY_HOPS)` (default 1
  for Railway). Also fixes proxy-IP logging in `audit.service.js:14` and auth logs.

## Implementation steps (ordered)

### Step 0 — trust proxy (prerequisite for the allowlist)
- `server/src/index.js`: add `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1)`
  before route mounts. Pin the hop count to Railway's proxy depth so `X-Forwarded-For`
  isn't spoofable.

### Step 1 — IP-allowlist middleware on `/webhook/*`
- NEW `server/src/middleware/mpesaIpAllowlist.middleware.js`. Factory style matching
  `requireRole`/`authorize`: `const mpesaIpAllowlist = (opts) => (req, res, next) => {…}`,
  `module.exports = { mpesaIpAllowlist }`.
- Read `req.ip` (now trustworthy after Step 0); CIDR-match against `MPESA_ALLOWED_IPS`
  (comma-separated). Reject with `return res.status(403).json({ message: 'Forbidden source' })`
  — never `next(err)`. Bypass (with a `console.warn`) when `NODE_ENV !== 'production'` or
  `MPESA_ALLOWED_IPS` is empty (dev/sandbox).
- Attach to both webhook routes: `mpesa.routes.js:10-11`.

### Step 2 — independent STK-Query confirm before settling
- `mpesa.service.js`: extract pure `queryStkStatus(checkoutRequestId) → { resultCode, raw }`
  (the Daraja query call at `:332-339`, **no settlement**). Refactor `pollTransactionStatus`
  to call it then settle — BullMQ poller behavior (`mpesa.job.js:50`) unchanged.
- In `processSTKCallback` (`:287`), after resolving the pending txn and before
  `_finalizeTransaction`, call `queryStkStatus(txn.checkoutRequestId)`; settle **only** if
  it returns `ResultCode 0`. On mismatch → log + `FraudFlag` (possible forgery), do not
  settle. Gate behind `MPESA_REQUIRE_QUERY_CONFIRM` (default true; dis-able for flaky
  sandbox).

### Step 3 — amount validation (from callback metadata)
- STK path: in `_finalizeTransaction` (`:153-176`), extract the `Amount` item alongside
  receipt/phone (`:155-157`); load the trade and refuse to settle if
  `Number(Amount) !== trade.amountKes` → mark txn `failed` + `FraudFlag`. Do the amount
  check **before** the confirm CAS/settle.
- Manual path: `MpesaTransaction.model.js` gains `manualPayment.amountKes` (Number).
  `verifyManualPayment` (`:214`) takes the admin's observed amount; controller
  (`mpesa.controller.js:33`) reads `{ status, notes, amountKes }`. Validate
  `amountKes === trade.amountKes` before settling; store it; mismatch → reject + FraudFlag.

### Step 4 — receipt/reference uniqueness
- `MpesaTransaction.model.js`: `mpesaReceiptNumber` → `unique: true, sparse: true`
  (mirror `checkoutRequestId:6`); `manualPayment.referenceCode` → unique sparse (partial).
- Handle `E11000` from the confirm CAS in `_finalizeTransaction` as "already processed"
  (respond 200, no double credit) — the index is the hard replay backstop.
- **Migration caveat:** a unique index build fails if duplicate receipts already exist —
  check/clean the collection first.

### Step 5 — response-hardening (defense in depth)
- Trim `triggerStkPush` response (`mpesa.controller.js:13`) so `checkoutRequestId` /
  `merchantRequestId` are not returned to the buyer.
- `stkPushWebhook` (`mpesa.controller.js:57-65`): respond **200** for known-and-handled
  cases (incl. unknown/duplicate txn) so Daraja doesn't retry forged/garbage forever;
  reserve 500 for genuine transient errors.

### Step 6 — env + docs
- `server/.env.example`: add `MPESA_ALLOWED_IPS`, `TRUST_PROXY_HOPS`,
  `MPESA_REQUIRE_QUERY_CONFIRM`; document current Safaricom/Daraja egress ranges (verify
  before prod). Remove dead `VAULT_ENCRYPTION_IV` if present.

### Step 7 — THEN hooks (separate follow-up, NOT in this plan)

## Files in scope

- `server/src/index.js` — `trust proxy`
- `server/src/middleware/mpesaIpAllowlist.middleware.js` — NEW
- `server/src/routes/mpesa.routes.js` — attach allowlist to `/webhook/*`
- `server/src/controllers/mpesa.controller.js` — trim trigger response; webhook status
  codes; manual-verify `amountKes` input
- `server/src/services/mpesa.service.js` — `queryStkStatus` refactor; query-gate in
  `processSTKCallback`; amount check in `_finalizeTransaction`; manual amount in
  `verifyManualPayment`; E11000 handling
- `server/src/models/MpesaTransaction.model.js` — `mpesaReceiptNumber` unique+sparse,
  `manualPayment.referenceCode` unique+sparse, `manualPayment.amountKes`
- `server/.env.example` — new config; drop dead `VAULT_ENCRYPTION_IV`
- `server/tests/mpesa.webhook.test.js` — NEW

## Test plan

Harness matches the existing inline pattern (no global setup file; env set in `beforeAll`;
`request(app)`; per-test collection wipe). Daraja calls mocked (stub `queryStkStatus` /
`getOAuthToken`); `REDIS_URL` unset so the BullMQ worker no-ops.

- **A. Forged callback, query says fail** → trade stays `payment_window`, txn not
  confirmed, FraudFlag created. (standalone server)
- **B. Non-zero ResultCode** → txn `failed`, 200 `{status:'received'}`. (standalone)
- **C. Unknown/duplicate txn** → 200, no settlement, no retry storm. (standalone)
- **D. Amount mismatch** (callback `Amount != trade.amountKes`, query ok) → not settled,
  FraudFlag. (needs replica set — touches settlement path)
- **E. Happy path** (IP ok + query ResultCode 0 + amount match + fresh receipt) → txn
  `confirmed`, trade `paid`, wallet credited, escrow locked. (**MongoMemoryReplSet**,
  count 1)
- **F. Replay** (second callback, same `mpesaReceiptNumber`) → E11000 handled, no double
  credit. (replica set)
- IP allowlist unit test: allowed vs denied source with `trust proxy` on.

Manual: sandbox STK Push happy path + simulated webhook drop (poller confirms) + manual
fallback with admin amount entry (match and mismatch).

## Verification checklist
- [ ] Forged-callback test (A) fails to settle.
- [ ] `node --check` + `NODE_ENV=test node -e "require('./src/index.js')"` clean.
- [ ] `npm test` green (new suite + existing auth suite).
- [ ] Unique indexes build against a copy of prod data (no existing dup receipts).
