# SocialEscrow

> A fintech-grade escrow marketplace for buying and selling social media accounts safely via M-Pesa.

Built as a full-stack learning project covering MERN architecture, payment systems, real-time communication, encryption, fraud detection, and system design — all tailored to the African (Kenyan) market.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Database Models](#database-models)
- [The Escrow Flow](#the-escrow-flow)
- [M-Pesa Integration](#m-pesa-integration)
- [Build Phases](#build-phases)
- [Commit Convention](#commit-convention)
- [Author](#author)

---

## What It Does

SocialEscrow allows sellers to list social media accounts for sale and buyers to purchase them safely. The platform holds all funds in a central escrow wallet during the transaction. Funds are only released to the seller after the buyer confirms successful account access. If either party raises a dispute, funds are frozen and an admin resolves the case.

**Key flows:**
- Buyer pays via M-Pesa STK Push → funds held by platform
- Seller submits encrypted account credentials to a vault
- Buyer receives credentials only after payment is confirmed
- Buyer confirms access within 24 hours → platform pays seller via M-Pesa B2C
- Dispute raised → funds frozen → admin reviews evidence → resolves

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     TRUST LAYER                         │
│         Admin dashboard · Fraud engine · Disputes       │
├─────────────────────────────────────────────────────────┤
│                    BANKING LAYER                        │
│     Wallets · Ledger · Escrow engine · M-Pesa Daraja    │
├─────────────────────────────────────────────────────────┤
│                  MARKETPLACE LAYER                      │
│        Listings · Trades · Chat · Reputation            │
└─────────────────────────────────────────────────────────┘
```

### Money Flow
```
Buyer M-Pesa STK Push
        │
        ▼
Platform Paybill (Daraja C2B webhook)
        │
        ▼
Buyer wallet: available_balance += amount
        │
  Trade opened
        │
        ▼
Buyer wallet: available → locked_in_escrow
Platform escrow pool += amount
        │
  Seller releases credentials
        │
        ▼
Buyer confirms access
        │
        ▼
Platform fee (6%) deducted
Seller wallet: pending_payout += net amount
Platform triggers M-Pesa B2C → seller phone
        │
  Trade COMPLETED
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS v3 (own token set — no shadcn, no UI kit), Lucide icons |
| Backend | Node.js, Express.js |
| Database | MongoDB + Mongoose |
| Authentication | JWT (HTTP-only cookie), bcrypt |
| Payments | Safaricom Daraja API (M-Pesa STK Push + B2C) |
| Real-time | Socket.io |
| File storage | Cloudinary |
| Email | Nodemailer |
| Job queues | BullMQ (STK status polling, payout disbursements) |
| Frontend hosting | Vercel |
| Backend hosting | Railway |
| Database hosting | MongoDB Atlas |

---

## Project Structure

```
socialescrow/
├── client/                         # Next.js 14 frontend
│   ├── app/
│   │   ├── page.tsx                # Marketplace feed (infinite scroll)
│   │   ├── (auth)/
│   │   │   ├── login/              # Login page
│   │   │   └── register/           # Register page
│   │   ├── listing/
│   │   │   ├── [id]/               # Listing detail (server component)
│   │   │   └── create/             # Create listing + screenshot upload
│   │   ├── trade/
│   │   │   ├── new/                # Trade confirmation / payment hand-off
│   │   │   └── [id]/               # Trade room (rail, chat, dispute, payout)
│   │   ├── (dashboard)/
│   │   │   ├── seller/             # Seller dashboard + payout history
│   │   │   ├── buyer/              # Buyer dashboard
│   │   │   └── wallet/             # Ledger history
│   │   └── admin/
│   │       ├── page.tsx            # Overview: queues, circuit breaker
│   │       ├── payouts/            # Payout approval queue
│   │       ├── disputes/           # Dispute queue + resolution
│   │       ├── fraud/              # Fraud flags
│   │       ├── payments/           # Manual payment verification
│   │       ├── kyc/                # KYC review queue
│   │       ├── listings/           # Listing moderation
│   │       ├── trades/             # All trades (read-only)
│   │       ├── users/              # User directory, ban/unban
│   │       └── audit-log/          # Audit trail
│   ├── components/
│   │   ├── ui/                     # Button, Card, Field, Badge, Table, Dialog, Toast, States, Pagination
│   │   ├── layout/                 # AppShell, SiteHeader
│   │   ├── auth/                   # Auth form
│   │   ├── marketplace/            # Feed, listing card, filters
│   │   ├── trade/                  # TradeRoom, StatusRail, Payment/Credentials/Chat/Dispute/Payout panels
│   │   └── dashboard/              # WalletCard
│   ├── lib/
│   │   ├── api.ts                  # Axios instance + refresh interceptor
│   │   ├── status.ts               # Domain status vocabulary (tone + label)
│   │   ├── socket.ts               # Socket.io client (token re-read on reconnect)
│   │   ├── utils.ts                # formatKES, formatDate(Time), formatCountdown, cn
│   │   └── services/               # Trade, wallet, listings, admin, adminOps, risk
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   └── useTradeSocket.ts       # Joins the room, invalidates queries on events
│   ├── middleware.ts               # Route gating on the refresh cookie
│   ├── tailwind.config.ts          # "Vault Ledger" tokens
│   └── types/                      # TypeScript types
│
├── server/                         # Express backend
│   └── src/
│       ├── routes/                 # Route definitions
│       ├── controllers/            # Request handlers
│       ├── models/                 # Mongoose schemas
│       │   ├── User.model.js
│       │   ├── Listing.model.js
│       │   ├── Trade.model.js
│       │   ├── Wallet.model.js
│       │   ├── LedgerEntry.model.js
│       │   ├── EscrowRecord.model.js
│       │   ├── CredentialVault.model.js
│       │   ├── Message.model.js
│       │   ├── Dispute.model.js
│       │   └── FraudFlag.model.js
│       ├── middleware/
│       │   ├── auth.middleware.js   # JWT protect
│       │   ├── role.middleware.js   # authorize('admin')
│       │   └── error.middleware.js  # Global error handler
│       ├── services/
│       │   ├── mpesa.service.js     # Daraja STK Push + B2C
│       │   ├── vault.service.js     # AES-256 encrypt/decrypt
│       │   ├── escrow.service.js    # Lock/release/freeze/refund
│       │   ├── wallet.service.js    # Atomic debit/credit
│       │   ├── fraud.service.js     # Risk scoring
│       │   ├── email.service.js     # Nodemailer templates
│       │   └── notification.service.js
│       ├── sockets/
│       │   └── trade.socket.js      # Socket.io trade room
│       ├── jobs/
│       │   ├── paymentWindow.job.js # Auto-cancel expired trades
│       │   └── fraudScan.job.js     # Background fraud scan
│       ├── config/
│       │   └── db.js
│       └── index.js                 # App entry point
│
├── README.md
├── PROJECT_CONTEXT.md               # Current build state — read every session
├── LEARNINGS.md                     # Daily engineering journal
└── .gitignore
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (free tier)
- Safaricom Daraja developer account (sandbox for dev)
- Cloudinary account (free tier)

### 1. Clone and scaffold
```bash
git clone https://github.com/grevondenson/socialescrow.git
cd socialescrow
```

### 2. Server setup
```bash
cd server
npm install
cp .env.example .env
# Fill in your values in .env
npm run dev
```

### 3. Client setup
```bash
cd client
npm install
cp .env.local.example .env.local
# Fill in your values in .env.local
npm run dev
```

### 4. Verify
```
Server health: http://localhost:5000/health
Client:        http://localhost:3000
```

---

## Environment Variables

### Server (`server/.env`)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Secret key for signing JWTs |
| `JWT_EXPIRES_IN` | Token expiry e.g. `7d` |
| `BCRYPT_ROUNDS` | Password hash rounds (12 recommended) |
| `EMAIL_HOST` | SMTP host e.g. `smtp.gmail.com` |
| `EMAIL_USER` | Sender email address |
| `EMAIL_PASS` | App password (not account password) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `MPESA_CONSUMER_KEY` | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | Daraja app consumer secret |
| `MPESA_SHORTCODE` | Paybill/Till number |
| `MPESA_PASSKEY` | Daraja passkey |
| `MPESA_CALLBACK_URL` | Public HTTPS URL for C2B webhook |
| `MPESA_B2C_RESULT_URL` | Public HTTPS URL for B2C result |
| `VAULT_ENCRYPTION_KEY` | 32-char key for AES-256 vault |
| `PLATFORM_FEE_PERCENT` | Platform cut e.g. `6` |
| `PAYMENT_WINDOW_MINUTES` | Buyer payment window e.g. `30` |
| `CONFIRM_WINDOW_HOURS` | Buyer confirmation window e.g. `24` |

### Client (`client/.env.local`)

A ready-to-copy template lives at `client/.env.local.example`.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Express API base URL — **must include the `/api` prefix**, e.g. `http://localhost:5000/api`. The axios instance in `client/lib/api.ts` uses this verbatim as its `baseURL`, so services call bare paths like `api.get('/listings')` |
| `NEXT_PUBLIC_SOCKET_URL` | Socket.io server URL e.g. `http://localhost:5000` |

---

## API Reference

All routes are mounted under `/api`. The client's axios `baseURL` already includes that prefix, so
client code calls `api.get('/admin/payouts')`, not `/api/admin/payouts`.

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register buyer or seller |
| POST | `/api/auth/login` | Public | Login; access token in body, refresh token as httpOnly cookie |
| POST | `/api/auth/refresh` | Public (cookie) | Rotate the refresh token, issue a new access token |
| POST | `/api/auth/logout` | Public | Clear the refresh-token cookie |
| GET | `/api/auth/me` | Protected | Get current user |
| GET | `/api/auth/verify/:token` | Public | Verify email address |

### Listings
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/listings` | Public | Get all active listings (filter/sort/paginate) |
| GET | `/api/listings/:id` | Public | Get listing detail |
| POST | `/api/listings` | Seller (verified) | Create listing (multipart, up to 5 proof screenshots) |
| PATCH | `/api/listings/:id` | Seller | Update own listing |
| DELETE | `/api/listings/:id` | Seller | Remove own listing |

### Trades
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/trades` | Buyer (verified) | Initiate trade on a listing |
| GET | `/api/trades/:id` | Protected | Get trade detail |
| PATCH | `/api/trades/:id/mock-payment` | Buyer | Simulate payment (dev/sandbox) |
| POST | `/api/trades/:id/vault` | Seller (verified) | Submit encrypted credentials to the vault |
| GET | `/api/trades/:id/vault/reveal` | Buyer | One-time credential reveal (410 Gone after first read) |
| PATCH | `/api/trades/:id/release` | Seller | Release credentials to the buyer |
| PATCH | `/api/trades/:id/confirm` | Buyer | Confirm account received → triggers payout |
| GET | `/api/trades/:id/payout` | Seller | Seller's payout state for this trade (`PayoutQueue` row, `.lean()`; 403 for the buyer) |
| GET | `/api/trades/:id/messages` | Participant | Trade-room chat history |
| POST | `/api/trades/:id/messages` | Participant | Send a chat message (also pushed over Socket.io) |
| POST | `/api/trades/:id/dispute` | Buyer/Seller | Raise a dispute (freezes escrow) |

> There is no `PATCH /api/trades/:id/cancel`. Payment-window expiry / auto-cancel is **not
> implemented** (`paymentWindow.job.js` is an unimported stub), so a trade that is never paid stays
> in `payment_window` until an admin or a future sweep acts on it.

### Wallet
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/wallet` | Protected | Get own wallet balance |
| GET | `/api/wallet/ledger` | Protected | Get own ledger history |
| GET | `/api/wallet/reconcile` | Protected | Recompute and compare the caller's wallet identity against the ledger |

### M-Pesa
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/mpesa/stk-push` | Buyer (verified) | Trigger STK Push to buyer phone |
| POST | `/api/mpesa/manual-payment` | Buyer (verified) | Submit a manual M-Pesa payment reference |
| GET | `/api/mpesa/manual-payment/pending` | Admin | List manual payments awaiting verification |
| PATCH | `/api/mpesa/manual-payment/:id/verify` | Admin | Approve/reject a manual payment |
| POST | `/api/mpesa/webhook/stk-push` | Public (Safaricom, IP-allowlisted) | STK Push / C2B payment webhook |
| POST | `/api/mpesa/webhook/kyc` | Public (Safaricom, IP-allowlisted) | KYC verification webhook |
| POST | `/api/mpesa/webhook/b2c-result` | Public (Safaricom, IP-allowlisted) | B2C payout result webhook |
| POST | `/api/mpesa/webhook/b2c-timeout` | Public (Safaricom, IP-allowlisted) | B2C payout timeout webhook |

### Admin
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/platform` | Admin | Platform account + fees |
| PATCH | `/api/admin/platform/circuit-breaker` | Admin | Toggle the payout circuit breaker |
| GET | `/api/admin/users/kyc-review` | Admin | Pending KYC queue |
| GET | `/api/admin/stats` | Admin | Queue counts for the overview tiles (`{ data }`) |
| GET | `/api/admin/users?role=&banned=&q=&page=&per_page=` | Admin | User directory. Returns `{ data, meta }` |
| PATCH | `/api/admin/users/:id/ban` | Admin | Ban a user (`{ banReason }`) |
| PATCH | `/api/admin/users/:id/unban` | Admin | Restore a banned user (`{ reason }`) |
| PATCH | `/api/admin/users/:id/kyc-review` | Admin | Approve/reject a KYC submission |
| GET | `/api/admin/trades?status=&page=&per_page=` | Admin | All trades, read-only. Returns `{ data, meta }` |
| GET | `/api/admin/listings` | Admin | All listings incl. pending review |
| PATCH | `/api/admin/listings/:id/moderation` | Admin | Approve/reject a listing |
| PATCH | `/api/admin/listings/:id/remove` | Admin | Force-remove a listing |
| GET | `/api/admin/disputes` | Admin | Open dispute queue. Returns `{ disputes, pagination }` (not `{ data, meta }`) |
| PATCH | `/api/admin/disputes/:id/resolve` | Admin | Resolve: `release_to_seller` / `refund_to_buyer` / `split` (`split` needs both amounts) |
| GET | `/api/admin/payouts?status=&page=&per_page=` | Admin | Payout queue. Returns `{ data, meta }` |
| PATCH | `/api/admin/payouts/:id/approve` | Admin | Approve a pending payout (enqueues B2C) |
| PATCH | `/api/admin/payouts/:id/reject` | Admin | Reject a payout (`{ reason }`) |
| PATCH | `/api/admin/payouts/:id/requeue` | Admin | Requeue a cancelled payout (`{ reason }`) |
| GET | `/api/admin/fraud-flags?resolved=&riskLevel=&page=&per_page=` | Admin | Fraud flags. Returns `{ data, meta }` |
| GET | `/api/admin/audit-log?limit=&page=` | Admin | Audit trail. Returns `{ logs, pagination }` |

> Envelopes differ by endpoint: disputes and audits use named keys (`disputes`/`logs` + `pagination`),
> while payouts and fraud flags use `{ data, meta }`. Check the controller before wiring a client.

### AI
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/ai` | Protected | Claude assistant call (Messages API) |

---

## Database Models

| Model | Purpose |
|---|---|
| `User` | Auth, roles, reputation, KYC status |
| `Listing` | Social account listed for sale |
| `Trade` | Single buy/sell transaction with state machine |
| `Wallet` | User virtual wallet (available, locked, pending) |
| `LedgerEntry` | Immutable log of every KES movement |
| `EscrowRecord` | Escrow state per trade (locked/frozen/released/refunded) |
| `CredentialVault` | AES-256 encrypted account credentials, one-time reveal |
| `Message` | Trade room chat messages + system events |
| `Dispute` | Dispute case with evidence and resolution |
| `FraudFlag` | Automated risk flags with score and level |

---

## Platform Zones

| Zone | Auth required | What's accessible |
|---|---|---|
| **Public** | ❌ No | Browse marketplace, view listing detail, seller profile, price |
| **Authenticated** | ✅ Yes | Deposit funds, initiate trade, trade room, dashboard |
| **Admin** | ✅ Admin role | All trades, disputes, fraud flags, user management |

> Buyers browse and research listings fully before committing any funds.
> The "I'm Interested" button is the only auth gate — it redirects unauthenticated users to login then returns them to the listing.

---

## Listing Detail — Public View

Every listing detail page shows:

```
Account Info      platform, followers, niche, engagement rate
Media Proof       seller-uploaded screenshots (if any)
Seller Profile    name, tier badge
Price             KES formatted
CTA               "I'm Interested — Deposit & Start Trade" (auth-gated)
```

> **Not implemented:** seller ratings, reviews, verified-trade badges, member-since, completion rate
> and average release time. There is no Review model, route or UI; the reputation/reviews feature has
> never been built.

---

## The Escrow Flow

```
STEP 1  Buyer browses marketplace (no login needed)
        Views listing: account stats, screenshots, seller tier, price

STEP 2  Buyer decides they're interested
        Clicks "I'm Interested" → prompted to login/register if not authenticated
        Returns to listing after auth

STEP 3  Buyer deposits via M-Pesa STK Push
        Daraja C2B webhook → Buyer wallet credited
        Funds locked: available → locked_in_escrow
        LedgerEntry: DEPOSIT + ESCROW_LOCK
        Trade created → trade room opens (30min payment window)

STEP 4  Seller notified → submits credentials to vault (AES-256 encrypted)
        Credentials locked — not visible to anyone yet

STEP 5  Credentials released to buyer in trade room (one-time reveal)
        LedgerEntry: ESCROW_RELEASE
        Buyer has 24hrs to confirm access

STEP 6A  Buyer confirms access ✅
         Platform fee deducted (6%)
         M-Pesa B2C triggered → seller phone
         LedgerEntry: PLATFORM_FEE + SELLER_PAYOUT
         Trade status: COMPLETED
         Both parties leave reviews

STEP 6B  Dispute raised ⚠️
         Funds frozen: EscrowRecord status → frozen
         LedgerEntry: DISPUTE_HOLD
         Admin reviews evidence (chat logs, screenshots) → resolves

STEP 6C  Cancellation ❌
         Payment window expires or mutual cancel
         Funds refunded to buyer wallet
         LedgerEntry: REFUND — Trade status: CANCELLED
```

---

## M-Pesa Integration

Uses **Safaricom Daraja API** (sandbox for development, production requires business registration).

| API | Direction | Use case |
|---|---|---|
| STK Push | Platform → Buyer phone | Prompt buyer to pay |
| C2B Webhook | Safaricom → Platform | Confirm payment received |
| B2C | Platform → Seller phone | Pay seller on completion |
| Transaction Status | Platform → Daraja | Polling fallback if webhook missed |

> All M-Pesa amounts are stored as **integers in KES** (no floats) to avoid floating point precision issues.

---

## Build Phases

Phase numbering follows [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), which is the canonical build
record. (An earlier version of this README used a different, conflicting 1–10 scheme; it has been
retired.)

| Phase | Feature | Backend | UI |
|---|---|---|---|
| 1 | Auth + KYC (JWT, bcrypt, email verify, RBAC) | ✅ Done | ✅ Done |
| 2 | Listings + Marketplace (CRUD, Cloudinary, search, pagination) | ✅ Done | ✅ Done |
| 3 | Trade Initiation + Credential Vault (envelope encryption, one-time reveal) | ✅ Done | ✅ Done |
| 4 | Wallet + Ledger (MongoDB transactions, atomic ops, reconciliation) | ✅ Done | ✅ Done |
| 5 | M-Pesa STK Push + C2B Webhook (+ webhook hardening) | ✅ Done | ✅ Done |
| 5.5 | AI Assistant (`POST /api/ai`, Messages API) | ✅ Done | ⏳ Deferred |
| 6 | Dispute Resolution + Real-time Chat (Socket.io, admin resolution) | ✅ Done | ✅ Done |
| 7 | M-Pesa B2C Payouts + Automated Release (PayoutQueue, admin approval) | ✅ Done | ✅ Done |
| 8 | Advanced Fraud Engine (velocity/IP checks, auto-freeze) | ⏳ Upcoming | ⏳ Upcoming |
| 9 | Full Admin Dashboard UI (all admin panels) | — | ✅ Done |

**Current state:** Phases 1–7 are complete end to end — backend and UI. The three UI items that had
been deferred since 12 Aug 2026 (Phase 5 payment wiring, Phase 6 chat + dispute, Phase 7 seller payout
state) are built, and the Phase 9 admin console is finished: overview with the circuit-breaker control,
trades, users, and system health, alongside the eight panels that already existed.

Verification at this commit: `next build` emits 22/22 routes with zero type errors; the server suite is
**140 tests green** across 8 suites. What tests cannot prove is the money path against live Daraja —
that needs sandbox credentials and a public callback URL, and has still never been run.

Remaining work is Phase 8 (the fraud engine) and the deferred major dependency upgrades below. The
seven older admin panels render correctly but still use raw utility classes rather than the shared
`Table`/`Dialog`/`toast` primitives — a styling pass, not a functional gap.

### Known Deferred Upgrades

`npm audit fix` (without `--force`) has been run in both packages. The advisories below remain
because their only fix is a semver-major bump that needs a call-site review first. They are
deliberately deferred, not overlooked.

| Package | Current | Fix requires | Why deferred |
|---|---|---|---|
| `nodemailer` (server) | 6.x | 10.x | Major-version rewrite; SMTP-injection advisories need a review of every `sendMail`/template call site before upgrading |
| `uuid` (server) | 9.x | 14.x | Major bump; ESM/exports shape changed — check the `bullmq` transitive use before moving |
| `bullmq` (server) | 3.x | 6.x | Major bump; queue/worker APIs changed (Redis config, retries, job options) and `jobs/*.job.js` would need retesting against live Redis |
| `next` (client) | 14.2.35 | 16.x | Breaking App Router upgrade; stays on the 14.2.x patch line until a planned migration |
| `jest` (server) | 29.x | 30.x | Dev-only (test runner); the residual advisories are in Jest's own transitive deps and do not ship to production |

Audit totals at the time of writing:

- **Client — 13 vulnerabilities (2 moderate, 10 high, 1 critical).** Up from 6 after adding the UI
  toolchain. The critical and most of the high advisories trace back to `next` core; the rest are in
  the `postcss`/`tailwindcss` build chain and `eslint-config-next` → `@next/eslint-plugin-next` →
  `glob` → `brace-expansion`. None ship to the browser bundle except what `next` itself carries.
  Clearing them requires `next@16` plus a Tailwind major. Re-measured at this commit.
- **Server — 38 (31 high, 7 moderate, 0 critical).** Mostly dev/test tooling (`jest@29`, `nodemon`,
  `braces`), plus `nodemailer@6`, the `uuid@9`/`bullmq@3` pair, and transitive `socket.io`/`express`
  deps. None are shipped to the browser.

---

## Commit Convention

```
feat(scope):     new feature
fix(scope):      bug fix
refactor(scope): code change, no feature or fix
docs(scope):     documentation only
chore(scope):    build, config, tooling
test(scope):     tests
```

**Scopes:** `auth` `listings` `trade` `wallet` `mpesa` `vault` `escrow` `fraud` `admin` `socket` `ui` `config` `init`

**Examples:**
```
feat(auth): add JWT login with HTTP-only cookie
feat(mpesa): add Daraja STK Push service
fix(wallet): prevent negative balance on concurrent debit
docs(learnings): day 4 reflection on MongoDB transactions
```

---

## Author

**Elvis Ayilo (Esir)**
Full-stack MERN developer · Nairobi, Kenya
GitHub: [@grevondenson](https://github.com/grevondenson)

> Built to sharpen skills in fintech systems, M-Pesa integration, real-time architecture, and African market product development.