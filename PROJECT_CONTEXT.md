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
- [x] All MongoDB models created (User, Listing, Trade, Wallet, LedgerEntry, EscrowRecord, CredentialVault, Message, Dispute, FraudFlag)
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
- [ ] POST /auth/register — tested in Thunder Client
- [ ] POST /auth/login — tested in Thunder Client
- [ ] Email verification service (Nodemailer)
- [ ] GET /auth/verify/:token — tested
- [ ] Register page UI (Next.js)
- [ ] Login page UI (Next.js)
- [ ] Protected route working end-to-end

### Phase 2 — Listings + Marketplace
- [ ] Not started

### Phase 3 — Credential Vault
- [ ] Not started

### Phase 4 — Wallet + Ledger
- [ ] Not started

### Phase 5 — M-Pesa STK Push
- [ ] Not started

### Phase 6 — Trade Engine
- [ ] Not started

### Phase 7 — Trade Chat Room
- [ ] Not started

### Phase 8 — M-Pesa B2C Payout
- [ ] Not started

### Phase 9 — Fraud Engine
- [ ] Not started

### Phase 10 — Admin Dashboard
- [ ] Not started

---

## Architecture Decisions Log

| # | Decision | Choice | Reason | Date |
|---|---|---|---|---|
| 1 | Auth strategy | JWT in Authorization header | Stateless, works with Next.js SSR, easy to test in Thunder Client | 8 Jun 2026 |
| 2 | Password hashing | bcrypt, rounds: 12 | Industry standard, safe for prod-like learning | 8 Jun 2026 |
| 3 | User roles | buyer / seller / admin | Three distinct permission levels, admin set manually in DB | 8 Jun 2026 |
| 4 | Wallet created on register | Yes — Wallet.create() called inside register controller | Every user needs a wallet from day one, avoids null checks later | 8 Jun 2026 |
| 5 | Ledger entries are immutable | Pre-save hooks throw on update/findOneAndUpdate | Financial records must never be edited — append only | 8 Jun 2026 |
| 6 | KES stored as integers | No floats anywhere in financial models | Floating point precision causes financial bugs | 8 Jun 2026 |
| 7 | Platform fee | 6% deducted from escrow before seller payout | Covers operations, taken at completion not at deposit | 8 Jun 2026 |
| 8 | Credential encryption | AES-256-CBC, key in VAULT_ENCRYPTION_KEY env | Never store plain credentials, key separate from data | 8 Jun 2026 |
| 9 | Trade state machine | Enum field with explicit valid transitions | Prevents invalid state jumps (can't go CANCELLED → COMPLETED) | 8 Jun 2026 |
| 10 | M-Pesa amounts | Integer KES only | Daraja uses integer cents, consistency prevents reconciliation bugs | 8 Jun 2026 |
| 11 | Marketplace is fully public | GET /listings and GET /listings/:id require no auth | Buyers must be able to research listings, seller ratings and reviews before committing funds | 8 Jun 2026 |
| 12 | Deposit triggers trade | Buyer deposits funds via STK Push only after deciding to buy | Informed buyer → fewer disputes. Browse first, pay second | 8 Jun 2026 |
| 13 | Listing detail shows full seller profile | Seller rating, completion rate, trade count, avg release time, reviews visible on listing page | Buyer due diligence happens before funds move — builds platform trust | 8 Jun 2026 |
| 14 | "I'm Interested" gate | Button redirects to login if unauthenticated, then returns to listing | Smooth UX — don't block browsing, only gate the money action | 8 Jun 2026 |

---

## Data Models — Quick Reference

### User
```
name, email, password(hashed), phone, role(buyer|seller|admin),
isVerified, verifyToken, isBanned, reputation{totalTrades, completedTrades, rating}
```

### Listing
```
seller(ref), platform, followers, niche, engagementRate,
accountAgeYears, priceKes, description, proofScreenshots[], status(active|in_trade|sold|removed)
```

### Trade
```
listing(ref), buyer(ref), seller(ref), amountKes, platformFeeKes, sellerPayoutKes,
status(pending|payment_window|paid|credentials_released|completed|disputed|cancelled),
paymentWindowExpires, confirmWindowExpires, mpesaRef, payoutRef
```

### Wallet
```
user(ref), availableBalance, lockedInEscrow, pendingPayout,
totalDeposited, totalWithdrawn, currency(KES)
```

### LedgerEntry (IMMUTABLE — append only)
```
trade(ref), user(ref),
type(DEPOSIT|ESCROW_LOCK|ESCROW_RELEASE|PLATFORM_FEE|SELLER_PAYOUT|REFUND|DISPUTE_HOLD),
amountKes, balanceBefore, balanceAfter, reference, note
```

### EscrowRecord
```
trade(ref), buyer(ref), seller(ref),
grossAmount, platformFee, sellerPayout,
status(locked|frozen|released|refunded),
lockedAt, releasedAt, mpesaPayoutRef
```

### CredentialVault
```
listing(ref), trade(ref), encryptedCredentials(AES-256, select:false),
revealed(bool), revealedAt, revealedTo(ref), expiresAt
```

### Message
```
trade(ref), sender(ref), type(text|image|system), content, imageUrl
```

### Dispute
```
trade(ref), raisedBy(ref), reason, evidence[],
status(open|under_review|resolved),
resolution(release_to_seller|refund_to_buyer|split),
resolvedBy(ref), resolvedAt, adminNotes
```

### FraudFlag
```
user(ref), trade(ref),
flagType(NEW_ACCOUNT_HIGH_VALUE|MULTIPLE_DISPUTES|DUPLICATE_PHONE|IP_MISMATCH|...),
riskScore(0-100), riskLevel(low|medium|high|blocked), resolved
```

---

## Services — What Each Does

| Service | Responsibility |
|---|---|
| `mpesa.service.js` | Daraja OAuth token, STK Push, B2C payout, transaction status poll |
| `vault.service.js` | AES-256 encrypt/decrypt credentials, one-time reveal logic |
| `escrow.service.js` | Lock funds on trade open, release on completion, freeze on dispute, refund on cancel |
| `wallet.service.js` | Atomic debit/credit using MongoDB sessions, ledger entry creation |
| `fraud.service.js` | Risk score calculation, flag creation, pattern detection via aggregation |
| `email.service.js` | Nodemailer — verification email, trade notifications, dispute alerts |
| `notification.service.js` | In-app + email notifications for trade state changes |

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
  If logged in     → trigger M-Pesa STK Push (deposit)
  ↓
ESCROW ZONE
  Funds locked → trade room opens → credentials → confirm → payout
```

---

## Listing Detail — Data Displayed to Public

```
Account Info:      platform, followers, niche, engagement rate, account age, location
Media Proof:       up to 5 screenshots (Cloudinary)
Seller Info:       name, member since, verified badge
Seller Stats:      ⭐ rating, total trades, completion rate, avg release time
Seller Reviews:    last 5 reviews (buyer username, comment, date, verified trade badge)
Price:             KES formatted, platform fee note ("You pay KES X, seller receives KES Y")
CTA:               "I'm Interested — Deposit & Start Trade" (auth-gated)
```

---

## API Endpoints — Full Map

```
AUTH
  POST   /api/auth/register
  POST   /api/auth/login
  GET    /api/auth/me              [protected]
  GET    /api/auth/verify/:token

LISTINGS
  GET    /api/listings             [PUBLIC — filter, sort, paginate]
  GET    /api/listings/:id         [PUBLIC — full detail + seller profile]
  GET    /api/listings/:id/reviews [PUBLIC — seller reviews for this listing's seller]
  POST   /api/listings             [seller]
  PATCH  /api/listings/:id         [seller — own only]
  DELETE /api/listings/:id         [seller — own only]

TRADES
  POST   /api/trades               [buyer]
  GET    /api/trades/:id           [protected — parties only]
  PATCH  /api/trades/:id/confirm   [buyer]
  PATCH  /api/trades/:id/dispute   [buyer | seller]
  PATCH  /api/trades/:id/cancel    [buyer | seller]

VAULT
  POST   /api/vault/:listingId     [seller — submit credentials]
  GET    /api/vault/:tradeId/reveal [buyer — one-time reveal]

WALLET
  GET    /api/wallet               [protected]
  GET    /api/wallet/ledger        [protected]

MPESA
  POST   /api/mpesa/stk-push       [buyer]
  POST   /api/mpesa/callback       [public — Safaricom only]
  POST   /api/mpesa/b2c/result     [public — Safaricom only]
  POST   /api/mpesa/b2c/timeout    [public — Safaricom only]

MESSAGES
  GET    /api/messages/:tradeId    [protected — parties only]

ADMIN
  GET    /api/admin/overview       [admin]
  GET    /api/admin/trades         [admin]
  GET    /api/admin/disputes       [admin]
  PATCH  /api/admin/disputes/:id   [admin]
  GET    /api/admin/fraud          [admin]
  PATCH  /api/admin/users/:id/ban  [admin]
  GET    /api/admin/users          [admin]
  GET    /api/admin/ledger         [admin]
```

---

## Environment Checklist

- [ ] `MONGODB_URI` — MongoDB Atlas connection string added
- [ ] `JWT_SECRET` — strong random string set
- [ ] `EMAIL_USER` / `EMAIL_PASS` — Gmail app password configured
- [ ] `CLOUDINARY_*` — Cloudinary credentials added
- [ ] `MPESA_*` — Daraja sandbox keys added
- [ ] `VAULT_ENCRYPTION_KEY` — 32-char hex key set
- [ ] `CLIENT_URL` — set to http://localhost:3000 for dev

---

## Known Issues / Blockers

_None at project start — update this section as you build._

```
Example format:
- [BLOCKER] Daraja sandbox STK Push returns 500 — investigating passkey format
- [BUG] Wallet balance goes negative on concurrent trade — MongoDB session needed
- [TODO] Add rate limiting to /api/auth/login
```

---

## Next Session Goals

> Update this at the end of every session so the next session starts with a clear target.

**Monday 8 June — Session 1**
1. Run `setup.sh` and verify both servers boot
2. Create MongoDB Atlas cluster, add `MONGODB_URI` to `.env`
3. Test `POST /api/auth/register` in Thunder Client
4. Verify `Wallet` is auto-created alongside User
5. Test `POST /api/auth/login` — confirm JWT returned
6. Update this file and write `LEARNINGS.md` Day 1 entry
7. Commit: `feat(auth): add user registration and login endpoints`

---

## Useful Commands

```bash
# Start development
cd server && npm run dev
cd client && npm run dev

# Check MongoDB connection
curl http://localhost:5000/health

# Git workflow
git checkout -b feature/phase-X-name
git add .
git commit -m "feat(scope): description"
git push origin feature/phase-X-name

# Merge to dev when phase complete
git checkout dev
git merge feature/phase-X-name
git push origin dev
```

---

## Phase Completion Criteria

A phase is only complete when:
1. All backend routes tested and passing in Thunder Client
2. Frontend wired to backend and working in browser
3. Edge cases handled (empty state, error state, invalid input)
4. Code committed with conventional commit messages
5. `LEARNINGS.md` entry written for each day of the phase
6. This file updated with decisions and completed checkboxes

---

_Last updated: 8 June 2026 — Project scaffolded_