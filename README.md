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
| Frontend | Next.js 14, React 18, Tailwind CSS |
| Backend | Node.js, Express.js |
| Database | MongoDB + Mongoose |
| Authentication | JWT (HTTP-only cookie), bcrypt |
| Payments | Safaricom Daraja API (M-Pesa STK Push + B2C) |
| Real-time | Socket.io |
| File storage | Cloudinary |
| Email | Nodemailer |
| Job queues | BullMQ (Phase 6) |
| Frontend hosting | Vercel |
| Backend hosting | Railway |
| Database hosting | MongoDB Atlas |

---

## Project Structure

```
socialescrow/
├── client/                         # Next.js 14 frontend
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/              # Login page
│   │   │   └── register/           # Register page
│   │   ├── (marketplace)/          # Browse listings
│   │   │   └── listing/[id]/       # Listing detail
│   │   ├── (trade)/
│   │   │   └── [id]/               # Trade room (real-time)
│   │   ├── (dashboard)/
│   │   │   ├── seller/             # Seller dashboard
│   │   │   └── buyer/              # Buyer dashboard
│   │   └── (admin)/
│   │       ├── overview/           # Platform analytics
│   │       ├── trades/             # All trades
│   │       ├── disputes/           # Dispute queue
│   │       ├── fraud/              # Flagged users
│   │       └── users/              # User management
│   ├── components/
│   │   ├── ui/                     # Base components (Button, Input, Card)
│   │   ├── auth/                   # Auth forms
│   │   ├── marketplace/            # Listing cards, filters
│   │   ├── trade/                  # Trade room UI, chat
│   │   └── admin/                  # Dashboard panels
│   ├── lib/
│   │   ├── api.ts                  # Axios instance
│   │   └── utils.ts                # formatKES, cn, formatNumber
│   ├── hooks/                      # Custom React hooks
│   ├── middleware.ts                # Next.js route protection
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

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Express server URL e.g. `http://localhost:5000/api` |
| `NEXT_PUBLIC_SOCKET_URL` | Socket.io server URL e.g. `http://localhost:5000` |

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register buyer or seller |
| POST | `/api/auth/login` | Public | Login, returns JWT |
| GET | `/api/auth/me` | Protected | Get current user |
| GET | `/api/auth/verify/:token` | Public | Verify email address |

### Listings
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/listings` | Public | Get all active listings (filter/sort/paginate) |
| GET | `/api/listings/:id` | Public | Get listing detail |
| POST | `/api/listings` | Seller | Create new listing |
| PATCH | `/api/listings/:id` | Seller | Update own listing |
| DELETE | `/api/listings/:id` | Seller | Remove own listing |

### Trades
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/trades` | Buyer | Initiate trade on a listing |
| GET | `/api/trades/:id` | Protected | Get trade detail |
| PATCH | `/api/trades/:id/confirm` | Buyer | Confirm account received |
| PATCH | `/api/trades/:id/dispute` | Buyer/Seller | Raise dispute |
| PATCH | `/api/trades/:id/cancel` | Buyer/Seller | Cancel trade |

### Wallet
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/wallet` | Protected | Get own wallet balance |
| GET | `/api/wallet/ledger` | Protected | Get own ledger history |

### M-Pesa
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/mpesa/stk-push` | Buyer | Trigger STK Push to buyer phone |
| POST | `/api/mpesa/callback` | Public (Safaricom) | C2B payment webhook |
| POST | `/api/mpesa/b2c/result` | Public (Safaricom) | B2C payout result webhook |

### Admin
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/overview` | Admin | Platform analytics |
| GET | `/api/admin/trades` | Admin | All trades |
| GET | `/api/admin/disputes` | Admin | Open dispute queue |
| PATCH | `/api/admin/disputes/:id` | Admin | Resolve dispute |
| GET | `/api/admin/fraud` | Admin | Flagged users/trades |
| PATCH | `/api/admin/users/:id/ban` | Admin | Ban a user |

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
| **Public** | ❌ No | Browse marketplace, view listing detail, seller profile, ratings, reviews, price |
| **Authenticated** | ✅ Yes | Deposit funds, initiate trade, trade room, dashboard |
| **Admin** | ✅ Admin role | All trades, disputes, fraud flags, user management |

> Buyers browse and research listings fully before committing any funds.
> The "I'm Interested" button is the only auth gate — it redirects unauthenticated users to login then returns them to the listing.

---

## Listing Detail — Public View

Every listing detail page shows:

```
Account Info      platform, followers, niche, engagement rate, account age
Media Proof       up to 5 screenshots uploaded by seller
Seller Profile    name, member since date, verified badge
Seller Stats      ⭐ rating · total trades · completion rate · avg release time
Recent Reviews    last 5 reviews from previous buyers (verified trade badge)
Price             KES formatted — with fee breakdown shown to buyer
CTA               "I'm Interested — Deposit & Start Trade" (auth-gated)
```

---

## The Escrow Flow

```
STEP 1  Buyer browses marketplace (no login needed)
        Views listing: account stats, screenshots, seller rating, reviews, price

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

| Phase | Feature | Status |
|---|---|---|
| 1 | Auth + KYC (JWT, bcrypt, email verify, RBAC) | 🔨 In progress |
| 2 | Listings + Marketplace (CRUD, Cloudinary, search, pagination) | ⏳ Upcoming |
| 3 | Credential Vault (AES-256, one-time reveal) | ⏳ Upcoming |
| 4 | Wallet + Ledger (MongoDB transactions, atomic ops) | ⏳ Upcoming |
| 5 | M-Pesa STK Push + C2B Webhook | ⏳ Upcoming |
| 6 | Trade Engine + State Machine (BullMQ, auto-cancel) | ⏳ Upcoming |
| 7 | Trade Chat Room (Socket.io, JWT handshake) | ⏳ Upcoming |
| 8 | M-Pesa B2C Payout + reconciliation | ⏳ Upcoming |
| 9 | Fraud Engine (rule-based scoring, aggregation pipelines) | ⏳ Upcoming |
| 10 | Admin Dashboard (analytics, disputes, user management) | ⏳ Upcoming |

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