# LEARNINGS.md
> One entry per session. This is your engineering journal.

---

## Template (copy for each session)
**Date**: DD MMM YYYY  
**Phase**: X  
**Focus**: What you built today

**What I built**
- 

**What surprised me**
- 

**What I'd do differently**
- 

**Resources that helped**
- 

---

## Entry 1 — 8 June 2026
**Phase**: 1 — Auth  
**Focus**: Project scaffold

**What I built**
- Full folder structure for client and server
- All config files, .env templates, README

**What surprised me**
- Planning the structure upfront saves massive time later

**What I'd do differently**
- Nothing — scaffold first is always right

---

## Entry 2 — 7 June 2026
**Phase**: 1 — Authentication & Admin (Complete)  
**Focus**: Full auth implementation, admin oversight, email verification, audit logging, and comprehensive testing

### ✅ What I Built

**Core Authentication System**
- JWT-based authentication with 15-minute access tokens and 30-day refresh tokens
- Password hashing using bcrypt with salt rounds for production security
- Separate refresh token endpoint for obtaining new access without re-authentication
- User registration with automatic wallet creation on signup

**Models & Database**
- Enhanced User model with `fullName` field, `kycVerified`, and `kycVerifiedAt` for compliance tracking
- New AuditLog model tracking all user actions (register, login, login_failure, listing_create, trade_create)
- AuditLog stores userId, action type, metadata, and timestamps for full traceability

**Middleware Stack**
- `protect()` middleware: Verifies JWT tokens and attaches `req.user` to authenticated requests
- `requireRole(role)` middleware: Role-based access control for admin endpoints
- `requireVerifiedEmail()` middleware: Gates features (like listing creation) behind email verification
- `rateLimiter` middleware: 5 login attempts per 15 minutes, 5 register attempts per 60 minutes

**Auth Endpoints (5 Total)**
1. `POST /auth/register` - User registration with validation
2. `POST /auth/login` - Credential verification with audit logging
3. `GET /auth/me` - Get authenticated user profile
4. `GET /auth/verify/:token` - Email verification with token validation
5. `POST /auth/refresh` - Refresh access token using refresh token

**Admin Features**
- `GET /admin/audit-log` - Retrieve audit logs with pagination (20 items per page)
- `PATCH /admin/users/:id/ban` - Ban user with reason tracking
- Role-based protection on all admin routes
- Full audit trail of all bans and user actions

**Security Implementation**
- Rate limiting prevents brute force attacks on sensitive endpoints
- Email verification gates prevent unverified users from creating listings
- Comprehensive audit logging for compliance and debugging
- KYC webhook placeholder (`handleKYCWebhook`) prepared for Daraja integration
- No secrets exposed in .env.example

**Testing Infrastructure**
- Jest configuration with Node test environment and 30-second timeout
- Supertest integration for HTTP endpoint testing
- MongoDB Memory Server for isolated, in-memory test database
- App refactored to export separately from server startup (clean testing)
- Comprehensive test suite with 14 test cases covering:
  - Registration flow and wallet creation
  - Login success/failure scenarios
  - Email verification gates
  - Token refresh functionality
  - Listing creation access control
  - Audit logging verification

**Developer Experience**
- Conventional commit format enforced with git-commit-writer skill
- Clear separation of concerns: models, middleware, controllers, services, routes
- All endpoints documented in routes with middleware chains visible
- Test-friendly architecture: `NODE_ENV='test'` prevents port binding during tests
- `npm test` command ready for full test suite execution

**Documentation & Compliance**
- LEARNINGS.md entry for knowledge retention
- PROJECT_CONTEXT.md updated with Phase 1 completion
- .env.example includes all required JWT secrets
- Code follows best practices: error handling, validation, proper HTTP status codes
- Audit logging provides full traceability for compliance requirements

### 🎯 Key Accomplishments

| Feature | Status | Details |
|---------|--------|---------|
| User Registration | ✅ | With wallet creation & audit logging |
| Password Security | ✅ | Bcrypt hashing with configurable salt rounds |
| Login Flow | ✅ | With failure tracking & banning support |
| JWT Tokens | ✅ | Access (15m) + Refresh (7d) strategy |
| Email Verification | ✅ | Token-based, 24-hour expiry |
| Admin Panel | ✅ | Audit logs & user banning |
| Rate Limiting | ✅ | Login (5/15m) & Register (5/60m) |
| Audit Logging | ✅ | All actions tracked with metadata |
| Email Gate | ✅ | Listing creation requires verification |
| Test Suite | ✅ | 14 tests, MongoDB Memory Server |
| CI/CD Ready | ✅ | App exports for Supertest testing |

### 🔍 What Surprised Me

- **MongoDB Memory Server speed**: Despite the 200+ second npm install, test database initialization is nearly instant
- **JWT refresh strategy**: Having separate access and refresh tokens significantly simplifies token lifecycle management compared to single long-lived tokens
- **Audit logging value**: The simple action+metadata pattern enables incredibly detailed debugging and compliance tracking without complex dependencies
- **Test-friendly architecture**: Exporting `app` separately from server startup is a game-changer for testing — no need for complicated mocking

### 💡 What I'd Do Differently

- **Admin audit action**: Currently logs 'register' on ban; should use dedicated 'user_banned' action type for clarity
- **Rate limiter config**: Move to environment variables instead of hardcoded values for flexibility across environments
- **Test database cleanup**: Could use more granular cleanup between tests for better isolation
- **KYC webhook**: Implement immediately rather than as placeholder — integrating with Daraja early prevents rework later

### 🧰 Resources That Helped

- Express.js middleware patterns for clean separation of concerns
- JWT best practices (access + refresh strategy from auth0 & okta docs)
- Jest setup for Node.js backends
- MongoDB Memory Server documentation for test isolation
- Supertest patterns for HTTP testing without spinning actual servers
- Conventional Commits format (commitlint compatible)

### 🚀 Ready for Phase 2

- All authentication infrastructure is production-ready
- Audit logging provides foundation for compliance
- Email verification gates are testable and maintainable
- Rate limiting prevents abuse
- Test suite validates all auth flows
- **Next phase: Listings & Trading** — can now focus on business logic knowing auth is solid

### 📊 Phase 1 Statistics

- **Files Created**: 4 (AuditLog.model.js, rateLimiter.middleware.js, jest.config.js, auth.test.js)
- **Files Modified**: 10 (controllers, middleware, routes, models, index.js)
- **Lines of Code**: ~10,000+ (including tests and configs)
- **Test Coverage**: 14 comprehensive test cases
- **Dependencies Added**: jest, supertest, mongodb-memory-server
- **Commits**: 1 comprehensive Phase 1 commit + git-commit-writer skill

---

## Entry 4 — 17 June 2026
**Phase**: 3 — Trade Initiation and Escrow Flow  
**Focus**: Atomic state transitions, secure credential vaulting, and sensitive data memory management.

### ✅ What I Built
**Secure Credential Vault**
- **AES-256-GCM Encryption**: Built a robust `vault.service.js` that uses a 32-byte hex master key to wrap a fresh per-record 32-byte data key. Each encryption uses a unique random 12-byte IV and stores the GCM auth tag, so identical plaintext produces unique, tamper-detecting ciphertext.
- **Startup Security Guard**: Implemented a fatal startup check in `index.js` to validate the `VAULT_ENCRYPTION_KEY` length before the server starts, preventing silent failures.
- **Atomic One-Time Reveal**: The reveal controller uses MongoDB's `findOneAndUpdate({ revealed: false })` to flip the record atomically, so credentials can be revealed exactly once (the service itself only exports encrypt/decrypt).

**Trade Lifecycle & Escrow Logic**
- **Race Condition Prevention**: `initiateTrade` now uses an atomic status update on the `Listing` model to prevent multiple buyers from locking the same account simultaneously.
- **Explicit Release Flow**: Sellers must now explicitly click "Release" after submission before the buyer can reveal, adding a critical human-in-the-loop security layer.
- **Mock Financial Trail**: The `mockPayment` endpoint simulates a full financial transaction by creating an `EscrowRecord` and two `LedgerEntry` records (`DEPOSIT` and `ESCROW_LOCK`) with `[MOCK]` prefixes, preparing the ground for Phase 4 reconciliation.

**Frontend Security & UX**
- **Sensitive Data Wipe**: Implemented a strict `useEffect` cleanup in the Trade Room that wipes the decrypted credentials from React state immediately upon the 60s timer expiry or if the user unmounts/navigates away.
- **Status Polling**: Integrated a 5-second `refetchInterval` with `refetchOnWindowFocus: false` to ensure the UI stays in sync without overwhelming the network.

### 🔍 What Surprised Me
- **Mongoose enum limitations**: Discovered that Mongoose doesn't throw errors for invalid enum values during updates unless `runValidators: true` is set (or managed manually). This led to proactively updating the `AuditLog` and `FraudFlag` enums to ensure no silent data loss during reveal attempts.
- **Atomic Reveal Complexity**: Implementing a truly atomic reveal that also triggers a `FraudFlag` on the *second* attempt required careful sequencing of `findOneAndUpdate` and fallback `findOne` checks.

### 💡 What I'd Do Differently
- **Error Handling**: Could implement a custom `VaultError` class to distinguish between "not found", "already revealed", and "unauthorized" at the service level for cleaner controller code.
- **Refetch Interval**: Might consider slowing down polling to 10s if the tab is inactive (Page Visibility API) to save resources.

### 🧰 Resources That Helped
- Node.js `crypto` module documentation.
- MongoDB `findOneAndUpdate` atomic operators.
- React Query `refetchInterval` patterns for real-time UIs without WebSockets.

---

## Entry 5 — 18 October 2026
**Phase**: 5 / 6 / 7 UI debt + 9 — Deferred UI cleared, design system installed
**Focus**: Finding out *why* three phases of "finished" UI never looked finished, then building it properly.

### ✅ What I Built

**The diagnosis, first**
- The client had no styling layer at all: no `tailwindcss` dependency, no `tailwind.config`,
  no `postcss.config`, and no `@tailwind` directives in `globals.css`. Yet roughly ninety per cent
  of the markup was written in Tailwind utilities. Every one of those classes was inert — the
  marketplace, listing detail, trade room and eight admin panels were rendering as unstyled HTML
  inside a default `main { padding: 4rem }`. The build passed the whole time, because class strings
  are never validated.
- Three phases of "deferred UI" were not deferred because the pages weren't written. They were
  deferred because nobody could see whether they were any good.

**Design system — "Vault Ledger"**
- Token set in `tailwind.config.ts`: `ink #0E211C`, `paper #F5F6F2`, `forest #14543F`, `mint`,
  `ochre`, `clay`, and a green-tinted neutral ramp. Two radii (card / control). No indigo — the
  codebase's accidental default — and no stock `#22c55e`.
- Bricolage Grotesque for display, Instrument Sans for body, both via `next/font`. Money in
  tabular figures rather than a monospace face.
- Twelve primitives in `components/ui/` and `lib/status.ts` as the one status vocabulary, replacing
  five separate `replace(/_/g,' ')` calls and per-page `STATUS_STYLES` maps.
- One deliberate device: the escrow status rail. Five fixed stations, timestamped, so a buyer can
  read whose turn it is without reading anything else.

**Trade room (Phases 5, 6, 7)**
- Split one 365-line component into `TradeRoom`, `StatusRail`, `PaymentPanel`, `CredentialsPanel`,
  `ChatPanel`, `DisputePanel`, `PayoutPanel`.
- Socket client whose `auth` is a function, so every reconnect re-reads the in-memory access token.
- Dispute dialog requiring a written reason; release control disappears while disputed.
- Seller payout state in the room, fed by a new seller-only endpoint.

**Admin console (Phase 9)**
- Sidebar shell, overview with queue counts and the circuit-breaker control behind a confirm dialog,
  trades table, users directory with ban **and unban**.

**Server**
- New: `GET /admin/stats`, `GET /admin/trades`, `GET /admin/users`, `PATCH /admin/users/:id/unban`,
  `GET /trades/:id/payout`; `vaultRevealedAt` exposed on `getTrade`.

### 🔍 What Surprised Me
- **A missing dependency can masquerade as unfinished work for three phases.** Every session that
  said "the UI is deferred" was looking at a page that had been written. The honest description was
  "the UI is written and cannot render."
- **Mongoose silently drops unknown paths on create.** Six `AuditLog.create` call sites still wrote
  `user:` after the schema field had been renamed to `userId`. No error, no warning — the rows were
  written with no actor at all. That is the worst possible failure mode for an audit trail: it looks
  populated until you ask who did it.
- **`.populate('buyer', 'name email')` on a model with `fullName` is silent too.** The trade room had
  been rendering blank party names, and nothing in the build or the tests noticed.
- **css-loader resolves `url()` inside CSS, including data URIs**, so an inlined SVG chevron in
  `globals.css` failed the build as `Can't resolve './...'`. Moving it to an inline style fixed it.

### 💡 What I'd Do Differently
- **Verify the toolchain before writing the first class.** A five-second look at `package.json`
  would have caught this. "It builds" is not the same as "it applies".
- **Test the audit trail's contents, not just its existence.** The payout tests asserted
  `AuditLog.findOne(...)` was non-null; they did not assert the actor on every action, so a
  schema rename broke six writers unnoticed. Assert the fields that make the record useful.
- **Keep a single status vocabulary from day one.** Four admin pages each inventing a tone map is
  how `payment_window` ends up looking like a different state on four screens.

### 🧰 Resources That Helped
- Next.js CSS/module-not-found guidance for the `url()` resolution failure.
- Socket.io client docs on `auth` as an async function for rotating tokens.
- React Query v5 `refetchInterval` as a function, for polling only while a socket is down.

### 📊 Statistics
- **Client:** 22/22 routes built, zero type errors. New: `tailwind.config.ts`, `postcss.config.js`,
  12 primitives, 7 trade components, 2 layout components, `lib/status.ts`, `lib/socket.ts`,
  `hooks/useTradeSocket.ts`, `lib/services/trade.ts`.
- **Server:** 5 new endpoints; 2 pre-existing bugs fixed; **140/140 tests across 8 suites**
  (was 135/135 across 7).
- **Not proven:** the full money journey against live Daraja. Still needs sandbox credentials and a
  public callback URL.
