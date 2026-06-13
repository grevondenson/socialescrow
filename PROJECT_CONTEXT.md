# PROJECT_CONTEXT.md
> Read this at the start of every session. Update it at the end of every session.
> This file is your memory across all coding sessions.

---

## Current Status

| Field | Value |
|---|---|
| **Active Phase** | Phase 1 — Auth + KYC |
| **Week** | Week 1 |
| **Start date** | 8 June 2026 |
| **Current branch** | `feature/phase-1-auth` |
| **Server** | http://localhost:5000 |
| **Client** | http://localhost:3000 |
| **DB** | MongoDB Atlas — `socialescrow` |

---

## What Has Been Built

### Phase 1 — Auth + KYC
- [x] Full project scaffold (client + server)
- [x] All MongoDB models created
- [x] Express server entry point with middleware stack
- [x] MongoDB connection config
- [x] Auth middleware (JWT protect)
- [x] Role middleware (authorize)
- [x] Error handler middleware
- [x] Auth controller stubs (register, login, getMe, verifyEmail)
- [x] Auth routes wired
- [x] Next.js middleware.ts (route protection)
- [x] `lib/api.ts` Axios instance with 401 interceptor
- [x] `lib/utils.ts` (formatKES, cn, formatNumber)
- [x] AuditLog model added
- [x] requireVerifiedEmail inside auth.middleware.js added
- [x] POST /auth/register — tested in Thunder Client
- [x] POST /auth/login — returns access + refresh tokens (cookie)
- [x] POST /auth/refresh — refresh token rotation
- [ ] Email verification service (Nodemailer)
- [x] GET /auth/verify/:token — tested
- [ ] Register page UI (Next.js)
- [ ] Login page UI (Next.js)
- [ ] Protected route working end-to-end
- [ ] Minimal admin JSON endpoints (fraud-flags, disputes, audit-log, ban)

### Phase 2 — Listings & Feed
- [x] Cloudinary service & Multer upload middleware
- [x] Listings API (CRUD, Search, Filtering)
- [x] Atlas Search aggregation pipeline (`$search`)
- [x] Next.js infinite scroll marketplace feed (`app/page.tsx`)
- [x] Listing detail RSC page (`app/listing/[id]/page.tsx`)
- [x] Listing creation form with FormData (`app/listing/create/page.tsx`)
- [x] React Query (`useInfiniteQuery`) integration
- [ ] Admin dashboard connection

---

## Platform Zones

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
AUTO_PAYOUT env flag (default: false)

When false (Phase 8 default):
  Trade completes → PayoutQueue entry created with status 'pending_approval'
  Admin sees queue at GET /api/admin/payouts
  Admin approves → B2C fires → seller receives M-Pesa

When true (Phase 9+ after fraud engine live):
  Trade completes → B2C fires immediately
  Admin only sees log, no manual approval step

Switch by updating: AUTO_PAYOUT=true in Railway env vars
```

---

## Audit Logging — High-Risk Actions

Every high-risk action creates an `AuditLog` entry:

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

Actions logged from Phase 8+:
  PAYOUT_QUEUED, PAYOUT_APPROVED, PAYOUT_SENT, PAYOUT_FAILED

Admin actions (all phases):
  ADMIN_BAN, ADMIN_UNBAN
  ADMIN_DISPUTE_RESOLVE
  ADMIN_PAYOUT_APPROVE
  ADMIN_FLAG_RESOLVE
```

---

## Phase 1 Minimal Admin Endpoints (JSON only — no UI yet)

```
GET   /api/admin/fraud-flags        list all FraudFlag documents
GET   /api/admin/disputes           list all Dispute documents
GET   /api/admin/audit-log          recent AuditLog entries (last 100)
PATCH /api/admin/users/:id/ban      ban a user { reason }
PATCH /api/admin/users/:id/unban    unban a user
```

Full React admin dashboard UI → Phase 10.

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
| `fraud.service.js` | Risk score calculation, auto-flag creation, pattern detection via aggregation pipelines |
| `email.service.js` | Nodemailer — verify email, trade notifications, dispute alerts, payout confirmations |
| `notification.service.js` | In-app + email on all trade state changes |
| `audit.service.js` | log(action, req, metadata) — called from controllers on every high-risk action |

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
- [ ] `VAULT_ENCRYPTION_KEY` — exactly 32 chars
- [ ] `AUTO_PAYOUT` — set to `false`
- [ ] `CLIENT_URL` — http://localhost:3000 for dev

---

## Known Issues / Blockers

_None at project start — update as you build_

---

## Next Session Goals

**Monday 8 June — Session 1**
1. [x] Run `setup.sh`, verify both servers boot clean
2. [x] Add `AuditLog` model to server/src/models/
3. [x] Add `requireVerifiedEmail` to auth.middleware.js
4. [x] Update `User.model.js` with kycName, kycPhone, kycVerified, sellerTier fields
5. [x] Test `POST /api/auth/register` in Thunder Client — verify wallet auto-created
6. [x] Test `POST /api/auth/login` — confirm access token + refresh cookie returned
7. [ ] Update this file, write LEARNINGS.md Day 1 entry
8. [ ] Commit: `feat(auth): add user registration and dual-token login`

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

_Last updated: 8 June 2026 — All architectural decisions locked in_