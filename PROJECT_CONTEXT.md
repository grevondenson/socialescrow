# PROJECT_CONTEXT.md
> Read this at the start of every session. Update it at the end of every session.
> This file is your memory across all coding sessions.

---

## Current Status

| Field | Value |
|---|---|
| **Active Phase** | Phase 7 — B2C Payouts & Automated Release _(backend done + tested, UNCOMMITTED; Phase 7 UI deferred. Phases 5 & 6 backend done; their UI deferred)_ |
| **Week** | Week 3 |
| **Start date** | 8 June 2026 |
| **Current branch** | `phase-6` |
| **Server** | http://localhost:5000 |
| **Client** | http://localhost:3000 |
| **DB** | MongoDB Atlas — `socialescrow` |

---

## What Has Been Built

### Phase 1 — Auth + KYC
- [x] Full project scaffold (client + server)
- [x] All MongoDB models created
- [x] Auth middleware (JWT protect) & Role middleware
- [x] POST /auth/register and POST /auth/login (Access + Refresh tokens)
- [x] KYC Webhook handler (Daraja C2B simulation)
- [x] Low name-similarity flag + manual review flow
- [x] Admin KYC review endpoint

### Phase 2 — Listings & Feed
- [x] Cloudinary service & Multer upload middleware
- [x] Listings API (CRUD, Search, Filtering)
- [x] Atlas Search aggregation pipeline (`$search`)
- [x] New listings default to `pending_review`
- [x] Public listing query only returns `active`
- [x] Admin approve/reject moderation endpoint
- [x] Next.js infinite scroll marketplace feed
- [x] Listing detail RSC page

### Phase 3 — Trade Initiation & Escrow
- [x] Atomic `initiateTrade` with race condition guard
- [x] Secure `vault.service.js` (Upgraded to Envelope Encryption)
- [x] Atomic `revealCredentials` with `410 Gone` + `FraudFlag` protection
- [x] Frontend: New Trade Initiation page (`/trade/new`)
- [x] Frontend: Trade Room with 60s memory-wipe timer
- [x] Startup security guard for encryption key validation

### Phase 4 — Wallet & Ledger
- [x] Wallet reconciliation service
- [x] Ledger entry validation (Immutability hooks)
- [x] PlatformAccount singleton auto-creation (upsert)
- [x] Payout circuit breaker guard in wallet & escrow services
- [x] Manual payment submission endpoint
- [x] Admin manual payment verification endpoint

### Phase 5 — M-Pesa STK Push Integration
- [x] `MpesaTransaction` model
- [x] `/api/mpesa/stk-push` trigger endpoint
- [x] STK callback processing in `mpesa.service.js`
- [x] BullMQ status polling (`mpesa.job.js`)
- [x] Backend startup / Redis / BullMQ graceful degradation (skips if missing)
- [x] Webhook payment-confirmation hardening (IP allowlist, STK Query re-confirm, amount validation, replay guard) — see Known Issues [FIXED 12 Aug 2026]
- [~] **DEFERRED (skipped for now)** — Frontend API wiring (Admin UI, STK Push UI, Manual Fallback UI)
- [~] **DEFERRED (skipped for now)** — Integration testing / End-to-end validation (needs the UI + a live/staging Daraja callback)

> ⚠️ **Phase 5 is BACKEND-COMPLETE, not fully complete.** The frontend UI and the full
> end-to-end run are **intentionally skipped for now** and tracked as debt (see _Deferred Work_
> below). We are proceeding to Phase 6 (backend) with this UI outstanding — it is deferred,
> not forgotten. By the "Phase Completion Criteria" this leaves #2 (frontend in browser) unmet.

> **Manual-payment endpoints live under `/api/mpesa`** (not `/api/wallet`):
> `POST /api/mpesa/manual-payment`, `GET /api/mpesa/manual-payment/pending` (admin),
> `PATCH /api/mpesa/manual-payment/:id/verify` (admin).

### Phase 5.5 — AI Assistant (added ahead of plan — verify before relying on it)
- [x] `POST /api/ai` — JWT-protected endpoint wired in `index.js`
- [x] `anthropic.service.js` — `callClaude()` HTTP wrapper (env: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`)
- [ ] ⚠️ Still on the legacy Text Completions API (`/v1/complete`, `max_tokens_to_sample`) with an invalid model id `claude-3.5-mini` — migrate to the Messages API (`/v1/messages`) and a real model id (e.g. `claude-haiku-4-5-20251001`) before use

## Pending Phases

### ⏸️ Deferred Work (skipped, tracked as debt — do NOT lose these)
- **Phase 5 frontend UI** — STK Push UI, Manual Fallback UI, Admin manual-payment verification UI.
  Backend endpoints exist and are hardened + tested; only the browser wiring is outstanding.
  Deferred on 12 Aug 2026 to proceed to Phase 6 backend. Revisit in the dedicated frontend pass.
- **Phase 5 end-to-end validation** — register → verify → STK push → webhook → escrow lock → reveal → payout.
  Blocked on the UI above + a live/staging Daraja callback URL.
- **`/api/ai` migration** — still on the legacy `/v1/complete` API with an invalid model id (see Phase 5.5).
- **Phase 6 frontend UI** — chat panel + message feed in `client/app/trade/[id]/page.tsx`; "Raise Dispute" button + confirmation and hiding "Release" when `status === 'disputed'`; `client/lib/socket.ts` + the `socket.io-client` dependency; admin disputes page (`client/app/admin/disputes/page.tsx`, currently a stub). All blocked on client access-token handling (store token from login, attach as Bearer, feed the socket `auth.token`) — the prerequisite that makes chat/disputes authenticable. Backend is done + tested (15 dispute/chat tests). Deferred on 12 Aug 2026.

### Phase 6 — Dispute Resolution & Real-time Chat
- [x] Socket.io integration for real-time messaging _(backend done — `sockets/trade.socket.js` implements JWT-handshake auth + `join_trade`/`leave_trade` room membership; wired into `index.js`, test-guarded so Jest stays clean)_
- [x] Dispute model and escalation flow _(backend done — `POST /api/trades/:id/dispute` freezes escrow → `Trade.disputed` / `EscrowRecord.frozen`; chat via `GET`/`POST /api/trades/:id/messages`)_
- [x] Admin dispute resolution endpoint _(backend done — `GET /api/admin/disputes`, `PATCH /api/admin/disputes/:id/resolve` for `release_to_seller` / `refund_to_buyer` / `split`; `escrow.service.split()` added, fee waived on splits)_
- [ ] **Phase 6 frontend UI** — deferred (see _Deferred Work_)

### Phase 7 — B2C Payouts & Automated Release
- [x] PayoutQueue model _(`models/PayoutQueue.model.js` — one row per trade (`trade` is unique), statuses `pending_approval → approved → processing → sent | failed | cancelled`, correlated to Daraja by `conversationId`/`originatorConversationId`)_
- [x] M-Pesa B2C integration for seller payouts _(`services/payout.service.js` — `sendB2C` (CAS `approved → processing`, breaker-gated), `processB2CResult`, `processB2CTimeout`; callbacks at `POST /api/mpesa/webhook/b2c-result` and `/b2c-timeout`, IP-allowlisted; dispatch via the `payout-disbursements` BullMQ queue in `jobs/payout.job.js`, 3 attempts, exponential backoff, 4xx classified `UnrecoverableError`)_
- [x] Admin payout approval flow _(`GET /api/admin/payouts`, `PATCH /api/admin/payouts/:id/approve|reject|requeue`; approve enqueues after commit, reject accepts `pending_approval`/`approved`, requeue takes a `cancelled` row back to `pending_approval`)_
- [x] Ledger + reconciliation correctness _(pre-Phase-7 bugfix: `WITHDRAWAL` debit type added, `SELLER_PAYOUT` classified as a credit, `PLATFORM_FEE` excluded from the wallet identity — see ADR 31)_
- [ ] **Phase 7 frontend UI** — deferred. Admin payout queue page + seller "payout sent" state in the trade room. Same blocker as Phase 6 UI (client access-token handling).

### Phase 8 — Advanced Fraud Engine
- [ ] Automated risk scoring (IP mismatch, velocity checks)
- [ ] FingerprintJS integration
- [ ] Auto-freeze accounts based on risk score

### Phase 9 — Full Admin Dashboard UI
- [ ] React admin dashboard
- [ ] System health monitoring


```
PUBLIC (no auth required)
  Browse marketplace, view listing detail, view seller profile + reviews + ratings
  ↓
  Buyer decides they're interested
  ↓
AUTHENTICATED GATE — "I'm Interested" button
  If not logged in → redirect to /login?redirect=/listing/:id
  If logged in + unverified → show verify email prompt
  If logged in + verified → trigger M-Pesa STK Push
  ↓
ESCROW ZONE
  Funds locked → trade room opens → credentials → confirm → payout
```

---

## Architecture Decisions — Complete Log

| # | Decision | Choice | Reason |
|---|---|---|---|
| 1 | Token strategy | Access (15min) + Refresh (30 days, HTTP-only cookie) | Short-lived access = stolen token expires fast. Refresh in HTTP-only cookie = invisible to XSS |
| 2 | Password hashing | bcrypt, rounds: 12 | Industry standard |
| 3 | User roles | buyer / seller / admin | Three permission levels. Admin set manually in DB only |
| 4 | Email verification gate | Allow login, block sensitive actions | Never lock users out of browsing. Gate: listing create, trade initiate, STK Push, vault submit |
| 5 | Sensitive action guard | `requireVerified` middleware on financial routes | Applied per-route, not globally |
| 6 | KYC fields | Full name + phone number | Verified passively via M-Pesa — Daraja C2B callback returns FirstName/LastName/MSISDN for comparison |
| 7 | KYC verification timing | Verified at first M-Pesa payment, not at registration | Safaricom verifies the identity for free — no extra KYC API needed |
| 8 | Wallet created on register | Yes — Wallet.create() in register controller | Every user needs a wallet from day one |
| 9 | Ledger entries immutable | Pre-save hooks throw on update/findOneAndUpdate | Financial records are append-only. Never edit history |
| 10 | KES stored as integers | No floats anywhere in financial models | Floating point causes financial bugs. Store 15000, not 15000.00 |
| 11 | Platform fee | 6% deducted at completion, not at deposit | Taken when value is confirmed, not speculatively |
| 12 | Credential encryption | AES-256-CBC, key in VAULT_ENCRYPTION_KEY env var | Key separated from data. Never store plain credentials |
| 13 | Trade state machine | Enum with explicit valid transitions only | Prevents invalid jumps. CANCELLED → COMPLETED is impossible |
| 14 | Seller stats storage | Materialized on User.reputation, recomputed after each trade | O(1) reads for listing feed. Never aggregate per request on high-traffic pages |
| 15 | Seller tier / badge | none → verified → trusted → top_seller | Verified = email + KYC. Trusted = 5+ trades + no flags. Top = 20+ trades + 95%+ + 4.5+ rating |
| 16 | Architecture pattern | Modular monolith | One Express app, clear service boundaries. Controllers → Services → Models. No cross-controller calls |
| 17 | Service boundaries | controllers call services only, never other controllers | If microservices needed later, each service folder becomes a deployable |
| 18 | balanceBefore / balanceAfter | Always stored at write time in LedgerEntry | Never derived. Wallet = live balance. Ledger = immutable audit trail. Must stay in sync |
| 19 | MongoDB transactions | Sessions used for all wallet + ledger operations | Atomic: wallet debit + ledger entry succeed or both fail together |
| 20 | Race condition guard | `$gte: amountKes` in findOneAndUpdate query | Only one concurrent request can claim sufficient balance |
| 21 | STK Push failure handling | BullMQ polls transaction status, max 3 retries (2/4/8 min backoff), auto-cancel at window expiry | Covers network delays, Daraja webhook drops, buyer inaction |
| 22 | B2C payout release | `AUTO_PAYOUT=false` default — admin approves queue. Switch to `true` after fraud engine live | Mirrors real escrow launch strategy. Admin review = fraud safety net |
| 23 | Audit logging | AuditLog model from Phase 1 — IP + user agent on all auth + financial actions | Required for fraud detection, dispute evidence, admin accountability |
| 24 | IP + device collection | IP and user-agent from Phase 1. FingerprintJS added in Phase 9 | Collect early, use later |
| 25 | Admin actions auditable | Every admin action creates AuditLog entry + LedgerEntry where money moves | Full chain of custody on every financial decision |
| 26 | Admin dashboard in Phase 1 | JSON endpoints only (no UI). Full React dashboard in Phase 10 | Test logic in Thunder Client. Build UI when data is rich enough to display |
| 27 | Read model / search index | Phases 1–6: Mongoose indexes only. No Redis / separate read model | Proper indexes handle the load at learning scale. Add caching in Phase 10 if needed |
| 28 | Marketplace visibility | GET /listings and GET /listings/:id are fully public — no auth needed | Buyers research seller rating, reviews, price before committing funds |
| 29 | Trade initiation gate | "I'm Interested" → redirects to login if unauth → returns to listing after auth | Smooth UX. Never block browsing. Only gate the money action |
| 30 | Deployment stack | Vercel (Next.js) + Railway (Express + Redis) + MongoDB Atlas + Cloudinary | Railway public domain works as Daraja webhook URL from day one |
| 31 | Ledger classification for the wallet identity | `CREDIT_TYPES = ['DEPOSIT','SELLER_PAYOUT']`, `DEBIT_TYPES = ['ESCROW_RELEASE','WITHDRAWAL']`, `PLATFORM_FEE` excluded. Reconciliation asserts `sum(credits) − sum(debits) === availableBalance + lockedInEscrow + pendingPayout` | The identity has to hold from **the seller's wallet's** point of view, not the platform's. `SELLER_PAYOUT` is what escrow release *credits into* the seller — a credit, though the name reads like an outflow. `ESCROW_RELEASE` is the buyer's locked funds leaving their wallet — a debit. `WITHDRAWAL` (new in Phase 7) is the B2C disbursement that finally moves money off-platform, and is the only thing that clears `pendingPayout`. `PLATFORM_FEE` is excluded because it never touches a user wallet — it lands on `PlatformAccount`, so counting it would put the identity permanently out by the fee on every trade |

---

## KYC Flow — Detailed

```
REGISTRATION:
  User submits: fullName, phone, email, password, role
  Stored: user.kycName = fullName, user.kycPhone = phone
  user.kycVerified = false

FIRST M-PESA PAYMENT (STK Push + C2B webhook):
  Daraja callback returns:
    FirstName + MiddleName + LastName  ← from Safaricom account
    MSISDN                             ← phone number that paid

  Platform checks:
    normalize(callback.FirstName + LastName) === normalize(user.kycName)
    callback.MSISDN === user.kycPhone

  If match:
    user.kycVerified = true
    user.kycVerifiedAt = now
    AuditLog: { action: 'KYC_VERIFIED' }

  If mismatch:
    Trade blocked
    AuditLog: { action: 'KYC_MISMATCH', metadata: { stored, received } }
    FraudFlag created
    User notified to update their name/phone to match M-Pesa account
```

---

## Token Strategy — Detailed

```
ACCESS TOKEN
  Algorithm: HS256
  Expiry:    15 minutes
  Payload:   { id, role }
  Transport: Authorization: Bearer <token>

REFRESH TOKEN
  Algorithm: HS256
  Expiry:    30 days
  Storage:   HTTP-only, Secure, SameSite=Strict cookie
  Transport: Automatic with every request (cookie)
  Rotation:  New refresh token issued on every /auth/refresh call
             Old refresh token invalidated (stored in DB as used)

ENDPOINTS:
  POST /auth/login    → issues both tokens
  POST /auth/refresh  → validates refresh cookie → issues new access token
  POST /auth/logout   → clears cookie + invalidates refresh token in DB
```

---

## Email Verification Gates

| Action | Unverified allowed? | Behaviour |
|---|---|---|
| Browse marketplace | ✅ Yes | Full access |
| View listing detail | ✅ Yes | Full access |
| Login | ✅ Yes | Allowed — banner shown |
| Register | ✅ Yes | Allowed |
| Create listing | 🚫 No | 403 + `action: 'verify_email'` |
| Initiate trade | 🚫 No | 403 + `action: 'verify_email'` |
| Trigger STK Push | 🚫 No | 403 + `action: 'verify_email'` |
| Submit to vault | 🚫 No | 403 + `action: 'verify_email'` |

---

## Seller Tier System

| Tier | Badge | Requirements |
|---|---|---|
| `none` | — | Default |
| `verified` | ✅ Verified | Email confirmed + KYC matched (M-Pesa name/phone) |
| `trusted` | 🔵 Trusted Seller | Verified + 5+ completed trades + 0 active fraud flags |
| `top_seller` | ⭐ Top Seller | Trusted + 20+ trades + 95%+ completion + 4.5+ rating |

Recomputed by `reputationService.recompute(userId)` after every trade completion.

---

## STK Push Lifecycle

```
1. POST /api/mpesa/stk-push
   → Daraja returns CheckoutRequestID
   → MpesaTransaction { checkoutRequestId, status: 'pending', tradeId } saved
   → Trade status: 'payment_window', paymentWindowExpires = now + 30min
   → BullMQ job scheduled: check at 2min, 4min, 8min if no webhook

2A. Webhook fires (happy path)
   → MpesaTransaction.status = 'confirmed'
   → wallet.credit() + escrow.lock() (atomic, single session)
   → Trade status: 'paid'

2B. No webhook → BullMQ polls Daraja transaction status API
   → Max 3 attempts: 2min → 4min → 8min (exponential backoff)
   → Confirmed via poll → same as 2A
   → Failed via poll → MpesaTransaction.status = 'failed', notify buyer

2C. Payment window expires (BullMQ paymentWindow job)
   → Trade still in 'payment_window' → auto-cancel
   → Listing.status → 'active'
   → Both parties notified
```

---

## B2C Payout Strategy

```
AUTO_PAYOUT env flag (default: false) — implemented in Phase 7

When false (the current default):
  Escrow release → PayoutQueue row created, status 'pending_approval'
                   seller's wallet.pendingPayout credited (they are owed the money)
  Admin sees the queue at GET /api/admin/payouts?status=pending_approval
  Admin approves    → row → 'approved' → BullMQ job → sendB2C → 'processing'
  Daraja result     → 'sent'   + WITHDRAWAL ledger entry, pendingPayout cleared
                    → 'failed' + lastError, pendingPayout untouched (still owed)

When true (deferred to Phase 8, after the fraud engine is live):
  Escrow release → row created already 'approved', no human step.
  Dispatch still goes through the same queue + sendB2C + callbacks, so the
  audit trail and the kill switch are identical either way.

Switch by updating AUTO_PAYOUT=true in Railway env vars.

Safety rails, all Phase 7:
  - Kill switch: PlatformAccount.payoutsEnabled=false makes escrow release, sendB2C,
    and admin approve all throw 503. Toggle at PATCH /api/admin/circuit-breaker.
  - Boot guard: index.js exits if NODE_ENV=production OR AUTO_PAYOUT=true while any of
    the five MPESA_B2C_* / MPESA_INITIATOR_NAME / MPESA_SECURITY_CREDENTIAL vars is missing.
  - CAS on every transition, so two admins (or a retried job) can never double-disburse.
  - trade is unique on PayoutQueue → one payout per trade, ever. A cancelled row is the
    only thing that can be re-queued (PATCH /api/admin/payouts/:id/requeue).
  - 'failed' is NOT re-queueable: a timeout may mean Daraja paid and lost the callback.
    Retrying those needs a Transaction Status query first — Phase 8.
```

---

## Audit Logging — High-Risk Actions

Every high-risk action creates an `AuditLog` entry:

> **Convention:** the `action` enum in `models/AuditLog.model.js` is lowercase `snake_case`
> (the three `VAULT_*` values are legacy exceptions). The names below are the *intent*; only
> the Phase 7 block has been reconciled against the live enum. `AuditLog.create` throws on an
> unlisted action, so anything written from a controller must exist in the enum first — see the
> `platform_circuit_breaker` comment in the model for what that bug looks like in production.

```
Model: AuditLog {
  user, action, ip, userAgent, metadata (object), flagged (bool), timestamp
}

Actions logged from Phase 1:
  LOGIN, LOGIN_FAILED, REGISTER, LOGOUT
  KYC_SUBMIT, KYC_VERIFIED, KYC_MISMATCH
  EMAIL_VERIFY_REQUEST, EMAIL_VERIFIED

Actions logged from Phase 2+:
  LISTING_CREATE, LISTING_REMOVE
  TRADE_CREATE, TRADE_CANCEL, TRADE_CONFIRM, TRADE_DISPUTE

Actions logged from Phase 5+:
  STK_PUSH_TRIGGERED, STK_PUSH_CONFIRMED, STK_PUSH_FAILED
  VAULT_SUBMIT, VAULT_REVEAL

Payouts + kill switch (Phase 7 — live enum values, verbatim):
  payout_queued              escrow release put a row in PayoutQueue
  payout_approved            admin cleared it for disbursement
  payout_rejected            admin cancelled it (seller still owed)
  payout_requeued            admin sent a cancelled row back to pending_approval
  payout_sent                Daraja confirmed the B2C; WITHDRAWAL ledger entry written
  payout_failed              non-zero ResultCode or B2C timeout; seller still owed
  platform_circuit_breaker   payouts globally disabled/re-enabled

Admin actions (all phases):
  ADMIN_BAN, ADMIN_UNBAN
  ADMIN_DISPUTE_RESOLVE
  ADMIN_FLAG_RESOLVE
```

---

## Admin & Ops Endpoints (JSON only — no UI yet)

Confirmed wired in `admin.routes.js` (all `protect` + `requireRole('admin')`):

```
GET   /api/admin/audit-log                 recent AuditLog entries (paginated)
PATCH /api/admin/users/:id/ban             ban a user { reason }
GET   /api/admin/users/kyc-review          users pending KYC manual review
PATCH /api/admin/users/:id/kyc-review      approve/reject KYC
GET   /api/admin/listings                  admin listing queue
PATCH /api/admin/listings/:id/moderation   approve/reject a listing
PATCH /api/admin/listings/:id/remove       admin remove a listing
GET   /api/admin/platform                  PlatformAccount snapshot (escrow pool, revenue, breaker state)
PATCH /api/admin/platform/circuit-breaker  toggle payouts on/off

GET   /api/admin/payouts                   payout queue, newest first; ?status= &page= &per_page=
PATCH /api/admin/payouts/:id/approve       clear for B2C → enqueues the disbursement job
PATCH /api/admin/payouts/:id/reject        cancel a pending_approval/approved row { reason }
PATCH /api/admin/payouts/:id/requeue       send a cancelled row back to pending_approval { reason }

GET   /api/admin/disputes                  open disputes (paginated)
PATCH /api/admin/disputes/:id/resolve      release_to_seller | refund_to_buyer | split
```

The four payout endpoints are the only ones using the `{ data }` / `{ data, meta }` envelope and
`next(err)`; everything above them predates that convention and returns bare documents with
inline `res.status(500)`. New endpoints follow the envelope — the legacy ones are left alone.

Manual-payment admin endpoints (in `mpesa.routes.js`):

```
GET   /api/mpesa/manual-payment/pending    pending manual payments
PATCH /api/mpesa/manual-payment/:id/verify verify a manual payment
```

Daraja callbacks (in `mpesa.routes.js`, unauthenticated — `mpesaIpAllowlist()` is the only
source check, and it answers 403 directly rather than via the error middleware because Daraja
retries 5xx):

```
POST  /api/mpesa/webhook/stk-push          C2B payment confirmation
POST  /api/mpesa/webhook/kyc               KYC name/MSISDN from the first payment
POST  /api/mpesa/webhook/b2c-result        payout outcome — the only thing that settles a payout
POST  /api/mpesa/webhook/b2c-timeout       Daraja never dequeued the request → row 'failed'
```

Not yet built (still planned): `GET /api/admin/fraud-flags`,
`PATCH /api/admin/users/:id/unban`. Full React admin dashboard UI → Phase 9.

---

## Data Models — Quick Reference

### User
```
name, email, password(hashed+select:false), phone, role(buyer|seller|admin)
kycName, kycPhone, kycVerified, kycVerifiedAt
isVerified, verifyToken, verifyExpires
isBanned, banReason
sellerTier(none|verified|trusted|top_seller)
reputation {
  totalTrades, completedTrades, disputedTrades
  completionRate, avgReleaseTimeMin, rating, reviewCount
}
```

### Listing
```
seller(ref), platform, followers, niche, engagementRate,
accountAgeYears, priceKes, description, proofScreenshots[]
status(active|in_trade|sold|removed)
```

### Trade
```
listing(ref), buyer(ref), seller(ref)
amountKes, platformFeeKes, sellerPayoutKes
status(pending|payment_window|paid|credentials_released|completed|disputed|cancelled)
paymentWindowExpires, confirmWindowExpires
mpesaRef, payoutRef, cancelledBy(ref), cancelReason
```

### Wallet
```
user(ref), availableBalance, lockedInEscrow, pendingPayout,
totalDeposited, totalWithdrawn, currency(KES)
```

### LedgerEntry — IMMUTABLE
```
trade(ref), user(ref)
type(DEPOSIT|ESCROW_LOCK|ESCROW_RELEASE|PLATFORM_FEE|SELLER_PAYOUT|REFUND|DISPUTE_HOLD)
amountKes, balanceBefore, balanceAfter, reference, note
```

### EscrowRecord
```
trade(ref), buyer(ref), seller(ref)
grossAmount, platformFee, sellerPayout
status(locked|frozen|released|refunded)
lockedAt, releasedAt, mpesaPayoutRef
```

### CredentialVault
```
listing(ref), trade(ref)
encryptedCredentials(AES-256, select:false)
revealed(bool), revealedAt, revealedTo(ref), expiresAt
```

### Message
```
trade(ref), sender(ref), type(text|image|system), content, imageUrl
```

### Dispute
```
trade(ref), raisedBy(ref), reason, evidence[]
status(open|under_review|resolved)
resolution(release_to_seller|refund_to_buyer|split)
resolvedBy(ref), resolvedAt, adminNotes
```

### FraudFlag
```
user(ref), trade(ref)
flagType(NEW_ACCOUNT_HIGH_VALUE|MULTIPLE_DISPUTES|DUPLICATE_PHONE|
         IP_MISMATCH|RAPID_LISTINGS|SUSPICIOUS_CANCEL|WEBHOOK_MISMATCH|KYC_MISMATCH)
riskScore(0–100), riskLevel(low|medium|high|blocked)
resolved, resolvedBy(ref), note
```

### AuditLog ← ADD IN PHASE 1
```
user(ref), action(enum — see full list above)
ip, userAgent, metadata(object), flagged(bool), timestamp
```

### MpesaTransaction ← ADD IN PHASE 5
```
trade(ref), user(ref)
checkoutRequestId, merchantRequestId
status(pending|confirmed|failed|expired)
amountKes, mpesaReceiptNumber
phoneNumber, callbackPayload(raw JSON)
retryCount, lastPolledAt
```

---

## Services — Responsibilities

| Service | Does |
|---|---|
| `mpesa.service.js` | Daraja OAuth token, STK Push, C2B callback processing, B2C payout, transaction status poll |
| `vault.service.js` | AES-256-CBC encrypt/decrypt, one-time reveal logic, expiry enforcement |
| `escrow.service.js` | lock() release() freeze() refund() — all use MongoDB sessions |
| `wallet.service.js` | Atomic debit/credit with session, ledger entry creation, balance reconciliation |
| `reputation.service.js` | recompute(userId) → updates User.reputation + sellerTier after each trade |
| `reconciliation.service.js` | reconcileWallet() + reconcilePlatformAccount() — ledger-vs-balance integrity, auto-flag + circuit breaker on mismatch |
| `fraud.service.js` | Risk score calculation, auto-flag creation, pattern detection via aggregation pipelines |
| `email.service.js` | Nodemailer — verify email, trade notifications, dispute alerts, payout confirmations |
| `notification.service.js` | In-app + email on all trade state changes |
| `audit.service.js` | log(action, req, metadata) — called from controllers on every high-risk action |
| `anthropic.service.js` | callClaude() HTTP wrapper for the `/api/ai` assistant (experimental — see Phase 5.5) |

---

## Deployment Stack

| | Development | Staging | Production |
|---|---|---|---|
| Frontend | localhost:3000 | Vercel preview URL | Vercel (main branch) |
| Backend | localhost:5000 | Railway (staging service) | Railway (prod service) |
| Database | Atlas dev cluster | Atlas staging DB | Atlas prod cluster |
| Redis (Phase 6+) | localhost:6379 | Railway Redis | Railway Redis |
| Files | Cloudinary dev folder | Cloudinary staging | Cloudinary prod |
| Email | Gmail SMTP | Gmail SMTP | Resend |
| Monitoring | Console logs | Railway logs | Sentry |
| Webhook URL | ngrok tunnel | Railway public domain | Railway public domain |

> Railway public domain is available from day one — use it as the Daraja callback URL even in Phase 5 dev.

---

## Environment Checklist

- [ ] `MONGODB_URI` — Atlas connection string
- [ ] `JWT_SECRET` — strong random string (min 32 chars)
- [ ] `JWT_REFRESH_SECRET` — separate secret from JWT_SECRET
- [ ] `EMAIL_USER` / `EMAIL_PASS` — Gmail app password
- [ ] `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`
- [ ] `MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY`
- [ ] `MPESA_CALLBACK_URL` — Railway public URL
- [x] `VAULT_ENCRYPTION_KEY` — 64 hex characters (32 bytes)
- [x] `AUTO_PAYOUT` — set to `false`
- [x] `CLIENT_URL` — http://localhost:3000 for dev
- [ ] `MPESA_B2C_SHORTCODE` — B2C product shortcode (not the C2B `MPESA_SHORTCODE`)
- [ ] `MPESA_INITIATOR_NAME` — API operator username on the B2C product
- [ ] `MPESA_SECURITY_CREDENTIAL` — initiator password, RSA-encrypted + base64. **Pre-computed, never derived at runtime, never logged, never in a response.** Rotate if it ever appears in a log or diff
- [ ] `MPESA_B2C_RESULT_URL` / `MPESA_B2C_TIMEOUT_URL` — Railway public HTTPS URLs

The last five are enforced at boot: `index.js` exits 1 if `NODE_ENV=production` **or**
`AUTO_PAYOUT=true` and any of them is missing. It logs the missing *names* only.

---

## Known Issues / Blockers

- **[FIXED 12 Aug 2026]** `reconciliation.service.js` declared `reconcilePlatformAccount` twice as a top-level `const` → `SyntaxError: Identifier ... already declared`. Because it's imported via `wallet.controller → wallet.routes → index.js`, this crashed the entire server (and test suite) on boot. Removed the duplicate; kept the circuit-breaker-aware version. Verified: `node --check` passes and `NODE_ENV=test node -e "require('./src/index.js')"` loads clean.
- **[OPEN]** `/api/ai` uses the legacy Text Completions API and an invalid model id — see Phase 5.5. Do not rely on it until migrated.
- **[FIXED 12 Aug 2026]** M-Pesa payment-confirmation hardening — plan [PLAN-mpesa-webhook-hardening.md](PLAN-mpesa-webhook-hardening.md), Steps 0–6. Closed three confirmed vulnerabilities: (1) **self-forgeable webhooks** — added `trust proxy` (`index.js`) + a fail-closed IP allowlist middleware (`mpesaIpAllowlist.middleware.js`) on both webhook routes, plus an independent STK Query re-confirmation gate before any settlement (`MPESA_REQUIRE_QUERY_CONFIRM`, default on); (2) **unvalidated amount** — the callback `Amount` and the admin-entered manual amount are now checked against `trade.amountKes`; a mismatch marks the txn `failed` and raises a `WEBHOOK_MISMATCH` FraudFlag without settling; (3) **replay** — `mpesaReceiptNumber` and `manualPayment.referenceCode` are now `unique + sparse`, with an E11000 duplicate-key treated as an idempotent no-op. Also stopped leaking `checkoutRequestId`/`merchantRequestId` in the STK trigger response, and stopped returning HTTP 500 for unknown/duplicate callbacks (now `200 {status:'ignored'}` so Daraja stops retrying). Verified: `node --check` clean, app boots under `NODE_ENV=test`, and the new `tests/mpesa.webhook.test.js` passes **12/12** (forgery, non-zero result, unknown-txn ack, amount mismatch, happy-path settlement, receipt replay, manual match/mismatch, + 4 allowlist unit tests) against a `MongoMemoryReplSet`. Step 7 (git hooks) intentionally out of scope. **Deploy note:** build the two unique indexes against a prod data copy first — a live build fails if duplicate receipts already exist; and re-verify `MPESA_ALLOWED_IPS` against current Safaricom egress ranges (they drift).
- **[FIXED 12 Aug 2026]** `tests/auth.test.js` (was 8/14 red — pre-existing, independent of the M-Pesa work). Three causes: (1) **dominant** — `registerLimiter`/`loginLimiter` (`max: 5`, in-memory store) 429'd the 6th+ request because the counter never resets between tests, which cascaded into the `TypeError`/401 failures; (2) `register`/`login` deliver the refresh token as an httpOnly cookie (the frontend uses `withCredentials` + reads the `refreshToken` cookie), but the tests asserted `res.body.refreshToken`; (3) tests read `verifyToken` (a `select:false` field) without `.select('+verifyToken')` and posted an incomplete listing body. **Kept the secure cookie design** (confirmed correct against the client); fix was test-side (cookie assertions, `.select('+verifyToken')`, valid listing payload) + a `NODE_ENV==='test'` skip on the two limiters (`rateLimiter.middleware.js`, no production behaviour change). Verified: auth **14/14**, full suite **26/26** green.
- **[FIXED 12 Aug 2026]** `listings.controller.js` `createListing` cast the *optional* `accountAgeYears` via `Number(accountAgeYears)`; when omitted this is `NaN`, which Mongoose refuses to cast → **HTTP 500** on every listing POST that left the field out. Fixed by only setting `accountAgeYears` on the document when it's actually provided (non-null / non-empty). Required numerics (`followers`, `priceKes`) are already guarded by the missing-fields check; `engagementRate` is a String and untouched. Regression covered: the "listing creation after email verification" test in `auth.test.js` now posts *without* `accountAgeYears` and asserts 201.
- **[RESOLVED 12 Aug 2026]** Earlier note claimed "repo has no commits (detached HEAD)". That was a **misread of the wrong repository** — the session's outer working dir sits inside a separate git repo rooted at the home directory. The **actual project repo** (`socialescrow/socialescrow`) is healthy: real history, on branch `phase-5-mpesa-risk-mitigation`. ⚠️ Always run git from the project dir, not the outer folder.

---

## Next Session Goals

**Saturday 16 Aug 2026 — Phase 7 backend done (UNCOMMITTED)**
B2C payouts are code-complete and tested against plan [PLAN-phase7-b2c-payouts.md](PLAN-phase7-b2c-payouts.md), Steps 0–6. Delivered this session:
- **Step 0 — ledger/reconciliation bugfix** (two P0s found in the pre-phase audit): `SELLER_PAYOUT` was being counted as a debit and `PLATFORM_FEE` was inside the wallet identity, so reconciliation drifted by the fee on every completed trade. Added the `WITHDRAWAL` ledger type. See ADR 31.
- `PayoutQueue` model (one row per trade — `trade` is unique), `services/payout.service.js` (`sendB2C` / `processB2CResult` / `processB2CTimeout`), `jobs/payout.job.js` (BullMQ `payout-disbursements`, 3 attempts + exponential backoff, 4xx → `UnrecoverableError`, startup sweep for rows stranded at `approved`).
- Admin flow: `GET /api/admin/payouts` + `approve` / `reject` / `requeue`. Callbacks: `POST /api/mpesa/webhook/b2c-result` and `/b2c-timeout`, both IP-allowlisted.
- Two fixes found while building: the circuit-breaker audit write threw on a missing enum value *after* the breaker had already flipped (admin saw a 500 for a change that took effect); and the production error mask was flattening deliberate 503s into "internal server error", hiding the one signal that says retry-later rather than report-a-bug.
- Boot guard + `.env.example` block for the five B2C vars; `AUTO_PAYOUT=false`.
- **Jest green — 120/120** (`payout.test.js` 66). Not covered by tests: the `UnrecoverableError` classification and the startup sweep, both of which need live Redis.

Focus next on:
1. [ ] **Commit Phase 7** — 18 paths still uncommitted on `phase-6`. Then branch/PR; never push to `main`.
2. [ ] **Sandbox end-to-end B2C** — the one thing tests cannot prove: real Daraja credentials, real callbacks hitting the public URLs, `MPESA_ALLOWED_IPS` verified against current Safaricom egress.
3. [ ] Phase 8 groundwork the payout design already leans on: a repeatable sweep + Transaction Status query, which is also what would make `failed` rows safely re-queueable.
4. [~] **DEFERRED** — Phase 7 UI (admin payout queue, seller payout state in the trade room), blocked behind client access-token handling like Phases 5–6.
5. [ ] Migrate `/api/ai` off the legacy `/v1/complete` API (still open from 12 Aug).

**Tuesday 12 Aug 2026 — Phase 6 backend done**
Dispute resolution + real-time chat backend is code-complete and tested. Delivered this session:
- Socket.io wired into `index.js` (test-guarded); `sockets/trade.socket.js` does JWT-handshake auth + `join_trade`/`leave_trade` room membership; `emitToTrade()` helper.
- Chat: `GET`/`POST /api/trades/:id/messages` (participant-gated, persists + socket-pushes).
- Disputes: `POST /api/trades/:id/dispute` freezes escrow (`Trade.disputed`, `EscrowRecord.frozen`); admin `GET /api/admin/disputes` + `PATCH /api/admin/disputes/:id/resolve` (`release_to_seller` / `refund_to_buyer` / `split`). Added `escrow.service.split()` (fee waived, split carved from buyer's gross deposit) and widened `release()`/`refund()` guards to accept `frozen`/`disputed`. Extended `AuditLog` action enum.
- **Jest green — 41/41** (`--runInBand`): 26 prior + 15 new dispute/chat (`tests/dispute.test.js`, `MongoMemoryReplSet`). Clean exit, no open handles.

Focus next on:
1. [~] **DEFERRED** — Phase 6 frontend UI (chat panel, dispute button, admin disputes page, `socket.io-client`) + client access-token handling. See _Deferred Work_.
2. [~] **DEFERRED** — Frontend API wiring for Phase 5 + end-to-end integration test.
3. [ ] Migrate `/api/ai` off the legacy `/v1/complete` API to Messages API + a valid model id (or remove until needed).
4. [x] **Phase 7 (backend) complete** — `PayoutQueue`, M-Pesa B2C, admin approval flow. Done 16 Aug 2026.

**Friday 12 Aug 2026 — Backend confirmed through Phase 5**
Phases 1–5 backend is code-complete and the app module boots clean (verified today). Focus next on:
1. [x] Commit the working tree to `phase-5-mpesa-risk-mitigation` (M-Pesa hardening + auth/listing fixes + AI scaffold)
2. [~] **DEFERRED** — Frontend API wiring for Phase 5: STK Push UI, Manual Fallback UI, Admin manual-payment verification UI
3. [~] **DEFERRED** — End-to-end integration test: register → verify → STK push → webhook → escrow lock → reveal → payout
4. [x] Jest suite green — **26/26** (auth 14 + M-Pesa 12, `--runInBand`). Auth fixes were test-side + a test-env rate-limiter skip; secure cookie design kept (see Known Issues).
5. [ ] Migrate `/api/ai` off the legacy `/v1/complete` API to Messages API + a valid model id (or remove until needed)
6. [x] **Phase 6 (backend) complete** — Socket.io wired; Dispute controller/routes + admin resolution endpoint built + tested

---

## Useful Commands

```bash
# Development
cd server && npm run dev
cd client && npm run dev

# Health check
curl http://localhost:5000/health

# Git workflow
git checkout -b feature/phase-1-auth
git add .
git commit -m "feat(auth): description"
git push origin feature/phase-1-auth

# Merge to dev when phase complete
git checkout dev && git merge feature/phase-1-auth && git push
```

---

## Phase Completion Criteria

A phase is complete only when:
1. All backend routes pass in Thunder Client including error cases
2. Frontend wired to backend and working in browser
3. Edge cases handled (empty state, error state, invalid input, network failure)
4. AuditLog entries created for all high-risk actions in the phase
5. Conventional commits pushed to GitHub
6. LEARNINGS.md entry written for each session
7. This file updated — checkboxes ticked, decisions logged, next goals written

---

_Last updated: 12 Aug 2026 — Phases 1–5 backend confirmed against code; boot-time SyntaxError in reconciliation.service.js fixed; AI endpoint + admin/mpesa endpoints documented._