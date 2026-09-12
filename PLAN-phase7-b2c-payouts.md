# Plan: Phase 7 — B2C Payouts & Automated Release

> Status: **Steps 0–6 DONE (tested, uncommitted). Plan complete; remaining checklist items need a live/prod env.**
> Implementation specifics resolved against code (1 Explore pass, 16 files read).
> Last updated: 16 Aug 2026.

## Context

Phases 1–6 move money *in* and *between buckets*. Phase 7 is the first time money
**leaves the platform**, which is why it needs its own plan rather than "add a B2C call".

The seam already exists. `escrow.service.release()` (`escrow.service.js:71`) credits the
seller's `Wallet.pendingPayout` via `walletService.creditPendingPayout()`
(`wallet.service.js:249`) and writes a `SELLER_PAYOUT` ledger entry. Funds are already
marked "owed to seller"; Phase 7 only has to **disburse and drain** them.

Confirmed absent (= exactly this phase's scope): `grep -E 'B2C|PayoutQueue|AUTO_PAYOUT|SecurityCredential'`
over `server/src` returns **0 hits**. `AUTO_PAYOUT` is documented in ADR #22 but wired nowhere.
There is also **no `debitPendingPayout()`** — `wallet.service.js:285` exports only
`credit, debit, lockFunds, unlockFunds, creditPendingPayout`.

Reused as-is: Daraja OAuth (`mpesa.service.js:34`, cached token), `mpesaIpAllowlist()`
middleware (unsigned B2C result callbacks need the same source check as STK), the
`payoutsEnabled` circuit breaker, and the BullMQ pattern in `jobs/mpesa.job.js`.

## Design corrections discovered during exploration

Two were **prerequisites** — Phase 7 was unsafe without them. Both are now **fixed and
covered by `tests/reconciliation.test.js` (13 cases)**; see Step 0.

- **[P0 — confirmed bug] `reconcileWallet` matches the wrong field.**
  `reconciliation.service.js:32,38` aggregates `{ user: wallet._id }`, but `LedgerEntry.user`
  is a ref to **User** (`LedgerEntry.model.js:5`) and `wallet.service.js` writes `user: userId`.
  `wallet._id !== user._id`, so **both aggregates always return empty** → `expected` is always
  `0` → every funded wallet reports `delta = -actual`, `isBalanced: false`, and creates a
  `RECONCILIATION_MISMATCH` FraudFlag. Reachable today via `GET /api/wallet/reconcile`
  (`wallet.controller.js:68`). Must be `wallet.user`. Phase 7 cannot use reconciliation as a
  payout safety net while it reports false mismatches on every call.
- **[P0 — sign convention] `SELLER_PAYOUT` is classified as a debit but written as a credit.**
  `DEBIT_TYPES = ['SELLER_PAYOUT','PLATFORM_FEE']` (`reconciliation.service.js:16`), yet
  `creditPendingPayout` writes `SELLER_PAYOUT` when `pendingPayout` **increases**. The
  disbursement — when `pendingPayout` decreases and money truly leaves — has **no ledger type
  at all** (`LedgerEntry` enum, `:8`). Reusing `SELLER_PAYOUT` for it would write two
  same-type entries per trade and double-count. `LedgerEntry` is immutable
  (`:19-27`), so history cannot be rewritten — the fix is a new type + corrected
  classification (see Decision 1).
- **`ResponseCode: '0'` from B2C means "accepted", not "paid".** Unlike STK, the money moves
  asynchronously. Marking a payout `sent` on the synchronous response would drain
  `pendingPayout` for a payment that may still fail. Only the **Result callback** (or a
  Transaction Status query) proves disbursement.
- **`Trade` needs no new status.** `Trade.payoutRef` (`Trade.model.js:18`) already exists and
  is unused; `completed` stays terminal. Payout lifecycle lives in `PayoutQueue`, so the
  `Trade` status enum is untouched.
- **`AuditLog` has no payout actions** and mixes styles: lowercase snake_case
  (`dispute_resolved`) plus legacy uppercase `VAULT_*` (`AuditLog.model.js:6-13`).
  PROJECT_CONTEXT documents uppercase `PAYOUT_QUEUED` etc. — which would add a third style.
- **Mock seam:** `mpesa.service.js` is exported as a single object (`:628`) precisely so
  internal cross-calls go through the reference tests spy on. New B2C functions must follow
  that pattern or they won't be stubbable.

## Decisions

**Baked in (no sign-off needed — these follow existing code):**

- **Module style:** CommonJS. The server is 189 `require`/`module.exports` and **zero**
  `import`/`export`. `development-standard` says "ES Modules always"; the codebase says
  otherwise. Do **not** half-migrate mid-project — write Phase 7 in CommonJS and fix the
  skill (or schedule a repo-wide migration) separately.
- **Idempotency:** `PayoutQueue.trade` is `unique` (one payout per trade, the same E11000
  backstop `EscrowRecord` uses at `escrow.service.js:45`), plus `unique + sparse` on
  `originatorConversationId` and `transactionReceipt`, mirroring `mpesaReceiptNumber`
  (`MpesaTransaction.model.js:14`). A replayed Result callback is an idempotent no-op.
- **Double-send guard:** CAS before calling Daraja —
  `findOneAndUpdate({ _id, status: 'approved' }, { status: 'processing' })` — the same
  pending→confirmed CAS as `_finalizeTransaction` (`mpesa.service.js:211`). Two concurrent
  approvals cannot both fire B2C.
- **Secrets:** `MPESA_SECURITY_CREDENTIAL` is the **pre-computed** RSA-encrypted initiator
  password (never derived at runtime, never logged). Add a boot-time guard mirroring the
  `VAULT_ENCRYPTION_KEY` check (`index.js:28-32`): if `NODE_ENV=production` **or**
  `AUTO_PAYOUT=true`, require `MPESA_SECURITY_CREDENTIAL` + `MPESA_INITIATOR_NAME` or exit.
- **Audit actions:** lowercase, matching the majority style — `payout_queued`,
  `payout_approved`, `payout_rejected`, `payout_requeued`, `payout_sent`, `payout_failed`. Update
  PROJECT_CONTEXT's uppercase list to match; don't introduce a third convention.
- **Response contract (new endpoints only):** adopt `api-design` exactly — single resource
  `{ data }`, collection `{ data, meta: { total, page, per_page } }`, error
  `{ error: { code, message } }` (already emitted by `error.middleware.js:57`). Controllers
  **must** `next(err)` with `err.statusCode` — never inline `res.status(500)` like
  `admin.controller.js` does in 10 places. Do **not** add `success: true` (it appears nowhere
  in the codebase). Existing endpoints are left alone; normalizing them is a separate task.

**Resolved:**

1. ~~**Ledger classification.**~~ **CONFIRMED** — new debit type is `WITHDRAWAL` (chosen over
   `PAYOUT_SENT`: it closes the `totalDeposited`/`totalWithdrawn` vocabulary already in
   `Wallet.model.js`, was already referenced in `wallet.service.js:103`'s JSDoc, and
   generalizes to a future user-initiated cash-out from `availableBalance`). Classification as
   shipped, verified against all five escrow paths:

   | Type | Role | Why |
   |---|---|---|
   | `DEPOSIT` | credit | new money in |
   | `SELLER_PAYOUT` | **credit** (was debit) | seller's `pendingPayout` grows |
   | `WITHDRAWAL` | **debit** (NEW type) | money leaves the platform |
   | `ESCROW_RELEASE` | **debit** | buyer's funds leave for the seller |
   | `ESCROW_LOCK`, `REFUND`, `DISPUTE_HOLD` | neutral | internal bucket moves only |
   | `PLATFORM_FEE` | **excluded** | written with `user: trade.seller` "by convention" (`escrow.service.js:124`) but `sellerPayoutKes` is already net of fee — counting it would short the seller; the revenue lives in `PlatformAccount.revenueBalance` |

   Load-bearing detail: `release()` writes `ESCROW_RELEASE` at the full gross `trade.amountKes`
   (`escrow.service.js:116`) while `split()` writes it at `sellerAmount` (`:328`). Both are
   exactly what the invariant needs.
2. ~~**API versioning.**~~ **CONFIRMED — stay unversioned** (`/api/admin/payouts`), as
   recommended, for consistency with every existing route. A repo-wide `/api/v1` migration with
   a client base-URL switch is its own task; a half-versioned API is worse than an unversioned
   one.
3. ~~**When to debit `pendingPayout`.**~~ **CONFIRMED — on confirmed result only** (`sent`),
   never on approval, so a failed payout leaves the seller's balance intact and retryable.
   Cost: a window where `pendingPayout` is still funded while `status: 'processing'`. The
   unique `trade` index prevents a second payout in that window. Modelled by
   `simulateWithdrawal()` in `tests/reconciliation.test.js`; enforced in Step 2 by
   `queuePayout()` writing **no** ledger entry and touching **no** balance.

## Non-goals

Frontend UI (admin payout queue screen) is **deferred**, consistent with the Phase 5/6 UI
debt already tracked in PROJECT_CONTEXT. `AUTO_PAYOUT` stays `false` in production until the
Phase 8 fraud engine is live (ADR #22). Backfilling the response envelope onto existing
endpoints is out of scope.

## Implementation steps (ordered)

### Step 0 — reconciliation prerequisites ✅ DONE
- ✅ `reconciliation.service.js:32,38`: `user: wallet._id` → `user: wallet.user`.
- ✅ Added `WITHDRAWAL` to the `LedgerEntry` enum; `CREDIT_TYPES = ['DEPOSIT','SELLER_PAYOUT']`,
  `DEBIT_TYPES = ['ESCROW_RELEASE','WITHDRAWAL']`, `PLATFORM_FEE` excluded — with the
  classification rationale documented inline above both arrays.
- ✅ NEW `tests/reconciliation.test.js` — 13 cases: `delta: 0` across deposit+lock, release,
  release→withdrawal, refund, freeze, split, split→withdrawal; two negative cases proving the
  fix still catches a real mismatch (out-of-ledger wallet credit, and a phantom ledger entry);
  enum accept/reject; endpoint + auth.
- Full suite: **54/54 passing** (41 pre-existing + 13 new).

### Step 1 — `PayoutQueue` model ✅ DONE
- ✅ NEW `server/src/models/PayoutQueue.model.js`, `{ timestamps: true }`, integer KES:
  `trade` (ref, **unique**), `seller` (ref), `amountKes`,
  `status: ['pending_approval','approved','processing','sent','failed','cancelled']`
  (default `pending_approval`), `originatorConversationId` (unique+sparse),
  `conversationId` (sparse), `transactionReceipt` (unique+sparse), `approvedBy` (ref),
  `approvedAt`, `attempts` (default 0), `lastError`, `resultPayload` (Mixed),
  `queuedAt` (default now), `sentAt`.
- ✅ Indexes: `{ status: 1, createdAt: -1 }` (admin queue), `{ seller: 1, createdAt: -1 }`.
- ✅ NEW `tests/payout.test.js` — 6 cases asserting the model contract, incl. all three
  unique indexes (`await PayoutQueue.init()` first, or a never-built index passes silently)
  and that `sparse` really does let many unsent payouts coexist with null Daraja ids.
- Full suite: **60/60 passing** (54 + 6 new).

### Step 2 — queue on release ✅ DONE
- ✅ NEW private `queuePayout(trade, amountKes, session)` in `escrow.service.js` — creates the
  `PayoutQueue` row inside the caller's transaction, reads `AUTO_PAYOUT` **at call time** so
  the flag can flip without a restart, wraps E11000 → **409** exactly as `lock()` does for
  `EscrowRecord`, and writes the `payout_queued` audit in the same session. Not exported;
  covered through `release()`/`split()`.
- ✅ `release()` (step `1b`, after `creditPendingPayout`) queues `trade.sellerPayoutKes`.
- ✅ `split()` queues `sellerAmount` **inside the `sellerAmount > 0` guard** — a full refund to
  the buyer queues nothing, or an empty payout row would sit in the admin queue forever.
- ✅ Existing `payoutsEnabled` 503 guard is untouched and still fires before anything is
  queued (both call sites already check it).
- ✅ **Ordering correction:** the `AuditLog` enum addition had to be pulled forward from Step 6.
  An unknown `action` is a Mongoose ValidationError, and this write is *inside* the settlement
  transaction — leaving it to Step 6 would have aborted every release. All five `payout_*`
  actions added at once.
- ✅ `tests/payout.test.js` grows to 13 cases (7 new): pending_approval + `pendingPayout`
  credited but **not** debited and no `WITHDRAWAL` entry; audit attributed to the seller;
  `AUTO_PAYOUT=true` → `approved` with `approvedBy` unset; duplicate queue → 409 with the
  **whole release rolled back**; breaker open → 503 and nothing queued; split queues
  `sellerAmount` fee-free; `sellerAmount: 0` queues nothing.
- ✅ **Kill-switch fix (pulled in from the audit-enum chip).** `platform_circuit_breaker` was
  missing from the same enum, so `toggleCircuitBreaker` (`admin.controller.js:213`) threw
  *after* `PlatformAccount` had already been updated at `:207` and the catch at `:221` returned
  **500** — the breaker flipped and the admin was told it had failed. One enum value fixes it.
  3 more cases drive the switch through the real endpoint (trip → 200 + audit; tripped → release
  503 and nothing queued; cleared → payouts resume), because the 503 cases above set
  `payoutsEnabled` directly on the model and passed even while the endpoint was broken.
- Full suite: **70/70 passing** (60 + 10 new), incl. `dispute.test.js` which drives
  `release()`/`split()` through the real admin endpoint.

### Step 3 — `payout.service.js` (B2C) ✅ DONE
- ✅ NEW `server/src/services/payout.service.js`, exported as a single object (mock seam).
- ✅ `sendB2C(payoutId)` — validates config **and** the seller's MSISDN, and checks the circuit
  breaker, all **before** the `approved`→`processing` CAS, so a misconfiguration or a missing
  phone leaves the payout at `approved` (fixable, retryable) instead of stranded in
  `processing` with no request in flight. Then POSTs `/mpesa/b2c/v1/paymentrequest` with
  `CommandID: 'BusinessPayment'`, `PartyA` (B2C shortcode), `PartyB` (seller MSISDN via
  `normalizePhone`), `QueueTimeOutURL`/`ResultURL`; stores
  `OriginatorConversationID`/`ConversationID`; `$inc attempts`. Never sets `sent`.
  A Daraja rejection drops the payout to `failed` — no Result callback is coming, so
  `processing` would be a permanent dead end.
- ✅ **Deviation from the plan (deliberate):** the breaker is checked *here* as well as on the
  approve endpoint. A job can fire after the breaker trips, and this is the last gate before
  money leaves the platform.
- ✅ `processB2CResult(payload)` — matches the payout on `OriginatorConversationID` (ours,
  unique) falling back to `ConversationID`. `ResultCode 0`: one session → processing→sent CAS,
  `walletService.debitPendingPayout` (writes `WITHDRAWAL`), `transactionReceipt`,
  `Trade.payoutRef`, `payout_sent` audit. Receipt read from the `TransactionReceipt`
  parameter, falling back to `Result.TransactionID`. Non-zero → `failed` + `lastError`,
  `pendingPayout` untouched, `payout_failed` audit. Replay and E11000 → idempotent no-op.
- ✅ `processB2CTimeout(payload)` → `failed` + retryable, with the hazard documented inline: a
  queue timeout is weaker evidence than a non-zero ResultCode, so re-approval must be gated on
  a Transaction Status query rather than done blind.
- ✅ NEW `walletService.debitPendingPayout(userId, amountKes, tradeId, session)` — `$inc`
  `pendingPayout: -amount` behind a `$gte` guard, `WITHDRAWAL` ledger entry with
  `balanceBefore`/`balanceAfter`. Deliberately does **not** check `payoutsEnabled`: a
  disbursement M-Pesa already made must be recorded even with the breaker open, or the ledger
  would permanently disagree with reality.
- ✅ `mpesaService.normalizePhone` added to the export object (it was defined but not exported)
  so B2C reuses the STK normalization instead of duplicating it.
- ✅ `tests/payout.test.js` grows to 33 cases (17 new). Daraja stubbed via `global.fetch`;
  `getOAuthToken` stubbed through the service object seam. Covers plan items **C** (racing
  approvals → one 409, `fetch` called once, `attempts` stays 1), **D**, **E**, **F**, **H**,
  plus: the exact B2C request body; missing secrets; missing seller phone; Daraja rejection →
  `failed` + audit + seller still owed; `TransactionID` fallback; unknown correlation ids;
  no-`Result` envelope; timeout ignored once already `sent`.
- ✅ **`reconcileWallet(seller).delta === 0` after a real end-to-end disbursement** — checklist
  item J now holds against the actual B2C path, not `simulateWithdrawal()`.
- Full suite: **87/87 passing** (70 + 17 new).

### Step 3 notes for later steps
- `notification.service.js` is an empty stub, and no service in the codebase touches sockets —
  `emitToTrade` is called from controllers only (`admin.controller.js:345`,
  `trades.controller.js:303`). So the plan's "notify seller" moves to the **Step 5 webhook
  controller** rather than living in `payout.service.js`.
- `Wallet.totalWithdrawn` is still written nowhere. `debitPendingPayout` is the natural place,
  but `credit`/`debit` don't maintain `totalDeposited` either — updating one half would leave a
  misleading partial. Left alone; worth its own task.

### Step 4 — admin endpoints ✅ DONE
- `admin.routes.js`, unversioned per decision 2, all `protect, requireRole('admin')`:
  `GET /payouts` (`?status=`, `?page=`, `?per_page=`), `PATCH /payouts/:id/approve`,
  `PATCH /payouts/:id/reject`, `PATCH /payouts/:id/requeue` (added after Step 4 — see notes).
- `GET /payouts` answers `{ data, meta: { total, page, per_page } }` — the `api-design` envelope,
  deliberately **not** the legacy `{ logs, pagination }` / `{ disputes, pagination }` shape next
  to it. `seller` and `trade` populated, `.lean()`, newest first, `per_page` clamped to 100.
  Unknown `?status=` → **400 `INVALID_STATUS`** rather than a silently empty page.
- Approve: `pending_approval` → `approved` by CAS + `approvedBy`/`approvedAt`, audit
  `payout_approved`. Second approval → **409 `PAYOUT_NOT_PENDING`**. Breaker open → **503
  `PAYOUTS_DISABLED`**, checked *before* the CAS so the payout stays approvable once cleared.
- Reject: `cancelled` by CAS, audit `payout_rejected` with the reason. In-flight
  (`processing`/`sent`/`failed`) → **409 `PAYOUT_NOT_REJECTABLE`**.
- All three use `next(err)` with `err.statusCode` **and** `err.code`, so the middleware emits a
  real machine-readable code instead of falling back to `INTERNAL_SERVER_ERROR`.
- Suite at the end of Step 4: **50/50** payout cases, **104/104** full.
- Step 5 adds the enqueue: approve now hands the payout to the B2C worker *after* the
  transaction commits, in its own try/catch so a Redis failure cannot fail the approval.

**Deviations from the original Step 4 text, and why:**
1. **Approve does not enqueue the B2C job.** `jobs/payout.job.js` does not exist until Step 5, a
   synchronous Daraja call would reproduce the exact commit-then-500 shape this plan flags in
   `toggleCircuitBreaker`, and `approved` is already a resting state the system produces today
   under `AUTO_PAYOUT=true`. A stub dispatch seam now would be speculative. Step 5 wires it.
2. **Approve and reject each run in a transaction.** The status flip and its audit entry have to
   agree; `resolveDispute` is the in-repo precedent. Two extra lines, and it closes the same
   hole the kill-switch bug came from.
3. **Reject accepts `approved`, not just `pending_approval`.** An admin who approved the wrong
   row needs a way back. It races `sendB2C`'s `approved` → `processing` CAS and exactly one side
   wins, so a payout already in flight can never be cancelled.

### Step 4 notes for later steps
- **Rejecting is not a claw-back.** `pendingPayout` and the `SELLER_PAYOUT` credit both stand —
  the seller is still owed the money — so reconciliation stays at `delta: 0` (asserted).
  Because `trade` is unique, a cancelled row also **blocks re-queueing that trade**: recovery
  means putting the row back to `pending_approval`. No endpoint does that yet; if ops needs one,
  it is a small addition, not a redesign.
- **`per_page` vs `limit`.** The new endpoint takes `?per_page=`; the legacy admin endpoints take
  `?limit=`. Chosen to match the `per_page` key the response envelope requires. Folded into the
  same task as normalizing the legacy envelopes.
- **`PAYOUT_STATUSES` is duplicated** between `admin.controller.js` and the model enum. Two
  places, one line each; exporting a shared constant is worth doing when a third appears.
- ✅ **Production masks 5xx messages** — FIXED. `error.middleware.js` now carves out 503 from the
  generic-message rewrite: a 503 is never an accident (breaker, escrow refusing to move money),
  the message is operator-authored, and it is the only thing telling the caller to retry rather
  than report a bug. Everything else at 500+ is still masked; a test pins both halves.
- ✅ **Un-reject endpoint** — ADDED. `PATCH /api/admin/payouts/:id/requeue` takes a `cancelled`
  row back to `pending_approval` and `$unset`s `approvedBy`/`approvedAt` (a stale approver would
  misattribute the next approval). `cancelled` only: `failed` is deliberately excluded because a
  timeout is weaker evidence than a non-zero ResultCode — Daraja may have paid and lost the
  callback — so re-queueing those must be gated on a Transaction Status query, not an admin's
  guess. Audited as `payout_requeued`.

### Step 5 — result callbacks + worker ✅ DONE
- `mpesa.routes.js`: `POST /webhook/b2c-result` and `POST /webhook/b2c-timeout`, both behind
  the existing `mpesaIpAllowlist()`. ACK **200** for unknown/duplicate (the
  `stkPushWebhook` precedent at `mpesa.controller.js:79-85`); reserve 500 for transient failures.
- NEW `jobs/payout.job.js` following `mpesa.job.js` exactly: own queue name
  (`payout-disbursements`), `getRedisConnection()`, no-op warn when `REDIS_URL` is unset,
  `attempts: 3` exponential backoff (1m/2m/4m). Start/stop wired into `index.js` alongside
  `startMpesaWorker` and `gracefulShutdown`.
- Optional reconcile job: Transaction Status query for payouts stuck in `processing`
  (the analog of the STK re-confirm gate). **Not built** — deferred to Phase 8, see below.

**Deviations, and why:**
1. **`UnrecoverableError` on 4xx.** A `sendB2C` failure with `statusCode` 400/404/409 cannot
   change on a retry (no MSISDN, payout gone, no longer `approved`), and each retry re-logs the
   same failure. 503 still retries — the breaker may clear — and so do config errors, which
   carry no `statusCode` and might be fixed by the deploy that lands next.
2. **No BullMQ `jobId` dedupe.** Tempting, but BullMQ retains completed jobs, so a re-queued
   payout would collide with the retained job from its first approval and be silently dropped.
   A duplicate job is the safer failure: `sendB2C`'s `approved` → `processing` CAS turns the
   second one into a 409 that never reaches Daraja.
3. **Startup catch-up instead of a repeatable sweep.** `startPayoutWorker` enqueues every row
   still at `approved`. This is what heals an enqueue lost to a Redis blip, and it is the only
   dispatch path `AUTO_PAYOUT=true` rows have (escrow approves them without an admin request).
   **Caveat:** a payout approved while the worker is down waits for the next worker start. A
   repeatable sweep belongs in Phase 8, together with the Transaction Status reconcile.
   Enqueueing from `escrow.service` was rejected: it runs inside a caller-owned transaction, so
   the job could fire before commit and find nothing.
4. **`enqueuePayout` failure never fails the approve response.** It runs after the transaction
   commits and is wrapped in its own try/catch that logs. Throwing here would recreate exactly
   the commit-then-500 shape that made the kill switch a bug.
5. **Duplicate socket emits accepted.** `processB2CResult` returns the row untouched on a
   replay, so the controller cannot tell whether *this* call caused the transition without
   changing the service's return shape (and breaking Step 3's tests). A repeat `payout_sent`
   only happens when Daraja lost our first 200, and both events are idempotent for the client.
6. **New handlers use `logger`, not `console`.** Per the standard. The existing
   `stkPushWebhook`/`kycWebhook` `console.*` calls were left alone — not this step's scope.

### Step 6 — audit enum, env, docs ✅ DONE
- ✅ `AuditLog.model.js`: the five lowercase `payout_*` actions (pulled forward into Step 2),
  plus `platform_circuit_breaker` and `payout_requeued`. The remaining enum gaps (`kyc_review`,
  `listing_moderation`) and the `userId:`→`user:` actor bug are tracked separately.
- ✅ `.env.example`: new `M-Pesa B2C` section with all six vars, placed after
  `MPESA_REQUIRE_QUERY_CONFIRM` and before Redis. `MPESA_SECURITY_CREDENTIAL` carries the
  "pre-computed, never derived at runtime, rotate if it leaks" warning inline. `server/.env`
  was deliberately NOT touched — the operator adds the real values themselves.
- ✅ `index.js`: boot guard inside the existing `NODE_ENV !== 'test'` Security Guard block,
  after the `VAULT_ENCRYPTION_KEY` check.
- ✅ `PROJECT_CONTEXT.md`: Active Phase → Phase 7 (+ the stale `phase-5-mpesa-risk-mitigation`
  branch value corrected to `phase-6`), all Phase 7 boxes ticked with what actually shipped,
  ADR **31** for the ledger classification, the B2C Payout Strategy block rewritten around the
  real state machine + safety rails, the payout audit actions replaced with the live lowercase
  enum values, the four payout endpoints + four Daraja webhooks added to the endpoint list, the
  five B2C vars added to the Environment Checklist, and a 16 Aug session entry.

**Deviations from the plan, Step 6:**

1. **The boot guard checks all five B2C vars, not the two the Decisions section named.**
   The plan asked for `MPESA_SECURITY_CREDENTIAL` + `MPESA_INITIATOR_NAME`. Those five are
   exactly what `payout.service.sendB2C` validates at request time — and by then the failure
   costs a BullMQ retry storm and a payout stranded at `approved` with a seller waiting.
   Refusing to boot is strictly cheaper, and the widening adds no new failure mode: any env
   that could start before can still start.
2. **The stale uppercase audit list was corrected surgically, not rewritten.** Only the payout
   block was reconciled against the live enum (that block is this phase's to own). The Phase
   1–5 entries are still aspirational uppercase names, several of which are not in the enum at
   all, so a short note now states the lowercase `snake_case` convention and flags that only
   the Phase 7 block is verified. Rewriting names I have not traced to their call sites would
   have replaced one inaccuracy with another.
3. **Two adjacent doc errors fixed in passing:** `Current branch` was three phases stale, and
   `GET /api/admin/disputes` was listed under "not yet built" despite shipping in Phase 6.
   Both sit inside blocks this step edits.

**Guard verified three ways** (not a unit test — the guard calls `process.exit`, which Jest
cannot host, and it is skipped under `NODE_ENV=test` by design):
- `AUTO_PAYOUT=true` + vars missing → `FATAL ... Exiting.` listing the missing **names**, exit 1.
- `AUTO_PAYOUT=true` + all five present → guard silent, boot proceeds.
- `AUTO_PAYOUT` unset, non-production → guard skipped entirely.

## Files in scope

- ✅ `server/src/models/PayoutQueue.model.js` — NEW (DONE)
- ✅ `server/src/services/payout.service.js` — NEW (DONE)
- ✅ `server/src/jobs/payout.job.js` — NEW (DONE)
- ✅ `server/tests/payout.test.js` — NEW, 66 cases (DONE)
- ✅ `server/src/services/reconciliation.service.js` — P0 field fix + classification (DONE)
- ✅ `server/src/models/LedgerEntry.model.js` — `WITHDRAWAL` (DONE)
- ✅ `server/tests/reconciliation.test.js` — NEW, 13 cases (DONE)
- ✅ `server/src/services/wallet.service.js` — `debitPendingPayout` (DONE)
- ✅ `server/src/services/mpesa.service.js` — export `normalizePhone` (DONE)
- ✅ `server/src/services/escrow.service.js` — `queuePayout()` on `release()` + `split()` (DONE)
- ✅ `server/src/controllers/admin.controller.js`, `routes/admin.routes.js` — payout endpoints (DONE)
- ✅ `server/src/controllers/mpesa.controller.js`, `routes/mpesa.routes.js` — B2C callbacks (DONE)
- ✅ `server/src/models/AuditLog.model.js` — five `payout_*` actions + `platform_circuit_breaker` (DONE)
- ✅ `server/src/index.js` — payout worker start/stop + B2C boot guard (DONE)
- ✅ `server/.env.example` — B2C section, six vars (DONE)
- ✅ `PROJECT_CONTEXT.md` — Phase 7 ticked, ADR 31, audit list, endpoints, env checklist (DONE)
- ✅ `server/src/middleware/error.middleware.js` — 503 exempt from the production mask (DONE)

## Test plan

`tests/payout.test.js`, matching the existing inline harness (env in `beforeAll`,
`request(app)`, per-test collection wipe). **`MongoMemoryReplSet`** (count 1) — every
settlement path uses sessions. Daraja stubbed via the exported service object; `REDIS_URL`
unset so the worker no-ops.

- **A.** ✅ Release with `AUTO_PAYOUT=false` → `PayoutQueue` `pending_approval`, `pendingPayout`
  credited (not debited), `payout_queued` audit. Plus `AUTO_PAYOUT=true` → `approved`, the
  409 double-queue rollback, the 503 breaker path, and both split branches.
- **B.** ✅ Non-admin hits `GET /api/admin/payouts` and both `PATCH` routes → 403, payout
  untouched. Plus unauthenticated → 401.
- **C.** ✅ Double approve → second returns 409; B2C called **once** (CAS holds).
- **D.** ✅ Happy path: approve → B2C accepted (`processing`, `pendingPayout` untouched) →
  Result `ResultCode 0` → `sent`, `pendingPayout` debited **once**, one `WITHDRAWAL` entry,
  `Trade.payoutRef` set.
- **E.** ✅ Result non-zero → `failed`, `pendingPayout` intact, retryable.
- **F.** ✅ Duplicate Result callback (same receipt) → handled, no double debit.
- **G.** ✅ Result *and* timeout callbacks from a non-allowlisted IP → 403 (not 500 — Daraja
  retries 5xx), nothing settled. Plus the mirror case: allowlisted loopback → 200 and settled,
  so the 403 is provably the allowlist decision and not an unreachable route.
- **H.** ✅ `payoutsEnabled: false` → `sendB2C` throws 503, no B2C call, payout stays `approved`.
  ✅ And the same 503 from the approve *endpoint*, leaving it at `pending_approval`, approvable
  again after `{ action: 'clear' }`.
- **I.** ✅ Second `PayoutQueue` for the same trade → E11000 (plus duplicate
  `originatorConversationId` and `transactionReceipt`).
- **J.** ✅ Full-lifecycle reconciliation → `delta: 0`, now driven through the **real** B2C
  disbursement path rather than `simulateWithdrawal()`.

- **K.** ✅ Webhook wiring end-to-end through HTTP: result settles + reconciles, non-zero
  ResultCode fails without touching the wallet, replay ACKs with a single `WITHDRAWAL`,
  unmatched/malformed ACK 200 `ignored`, transient failure answers 500, timeout fails the row
  and leaves the seller owed, timeout after settlement ACKs and stays `sent`.
- **L.** Not covered by tests: the worker's `UnrecoverableError` classification and the startup
  catch-up, both of which need a live Redis. Verify in the sandbox run.

Manual: sandbox B2C happy path, simulated timeout callback, and a rejected payout. Plus:
worker picks up an approved payout from the queue, a 4xx failure is not retried, and the
startup catch-up dispatches a payout approved while the worker was down.

## Verification checklist
- [x] Funded wallets reconcile to `delta: 0` across all five escrow paths (P0 bug closed).
- [x] Reconciliation still flags real mismatches — the fix isn't blind.
- [x] `LedgerEntry` accepts `WITHDRAWAL` and rejects unknown types.
- [x] Tests C/F prove no double disbursement (CAS); I proves all three unique indexes hold.
- [x] `node --check` + `NODE_ENV=test node -e "require('./src/index.js')"` clean.
- [x] `npm test` green — **120/120** (payout suite 66).
- [x] `MPESA_SECURITY_CREDENTIAL` absent from logs, git, and API responses. Traced every
      reference: read once in `sendB2C`'s env destructure, placed into the Daraja request body
      (never logged), and its *name* only in the boot guard's `missing` array. `lastError` stores
      Daraja's response text, not the request. `server/.env` is gitignored (`.gitignore:2`) and
      untracked; `.env.example` carries a placeholder.
- [x] Boot guard exits when B2C secrets are missing. Verified on both arms —
      `NODE_ENV=production` alone, and `AUTO_PAYOUT=true` in development — each logging the
      missing names and exiting 1; silent when all five are present or when neither arm applies.
- [ ] `AUTO_PAYOUT=false` in the Railway prod env. **Operator action — cannot verify from here.**
- [ ] Sandbox end-to-end: real Daraja B2C credentials, real callbacks reaching the public
      result/timeout URLs, `MPESA_ALLOWED_IPS` re-checked against current Safaricom egress.
      The one thing no test can prove.
