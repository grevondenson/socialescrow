# SocialEscrow — Status & Bug Report

**Date:** 17 October 2026 · **Branch:** `phase-7` · **Scope:** stabilization + first vertical slice

---

## 1. Build & test status (verified, not assumed)

| Check | Result |
|---|---|
| `client && npm run build` | **PASS** — exit 0, 22 routes, no TS/ESLint errors |
| `server && npm test` | **PASS** — 7 suites, **135/135 tests**, exit 0 |
| Baseline regression | None — all original 120 tests still pass |
| New coverage | `confirm.test.js` (5) + `vault.test.js` (10) |
| `npm audit` client | 18 → **6** (5 high, 1 critical — all Next.js-track) |
| `npm audit` server | 52 → **38** (31 high, 7 moderate, **0 critical**) |

> Note: the original readiness assessment said server 14 / client 5 vulnerabilities. The real counts
> were **18** and (after the next bump) **13** — both understated.

---

## 2. Bugs found & fixed

Ordered by severity. Every one was confirmed against running code — none is speculative.

### P0 — Money could never move (the core defect)
`escrowService.release()` → `queuePayout` had **one** production caller: admin dispute resolution.
There was **no buyer "confirm receipt" endpoint**, so a happy trade stalled at `credentials_released`
forever. `Trade.status` even contained `'completed'`, which was never set anywhere.
**Fix:** new `PATCH /api/trades/:id/confirm` (buyer-only, `credentials_released` only) →
`escrowService.release()` → seller credited, payout queued, trade `completed`. Wired into the trade room.
**Tests:** happy path, seller-cannot-confirm, pre-release rejection, double-confirm, no-auth.

### P0 — Credential reveal returned 500 for every user
`vault.controller.js` selected only `+encryptedCredentials iv` from a schema where **six** crypto fields
are `select: false`. `authTag`, `encryptedDataKey`, `encryptedDataKeyIv`, `keyAuthTag` came back
`undefined`, so `decrypt()` threw. The entire vault mechanism — the foundation of the escrow — was
non-functional in production and had **zero** test coverage.
**Fix:** select all six fields. **Tests:** plaintext round-trip, role/state guards, double-reveal → 410 + `VAULT_DOUBLE_REVEAL` fraud flag.

### P1 — Confirm endpoint 400'd on every call
`AuditLog.action` is a Mongoose enum that lacked `trade_confirmed`; the audit write rejected the whole
transaction. This would have surfaced only in production.
**Fix:** added the enum value (same class of bug as the earlier `platform_circuit_breaker`).

### P1 — Client production build was broken
- Duplicate `/listing/[id]`: `(marketplace)` route-group stub vs the real 126-line page. **Deleted the stub.**
- `@/lib/services/listings` unresolvable: `tsconfig` had no `baseUrl`/`paths`. **Added the alias.**
- `react-intersection-observer` imported but undeclared (present only in `node_modules`; a clean `npm ci` broke). **Declared `^10.0.3`.**
- **Hidden behind those:** React Query v5 types `data` as `T | undefined` in three admin pages (guards don't narrow) — fixed with `(data ?? [])`; and `lib` target ES2020 lacked `String.replaceAll` — bumped to ES2021.

### P1 — Client auth did not exist
No token storage, no `Authorization` header, `useAuth` hardcoded `false`, login/register 8-line stubs,
middleware a no-op. **Fix:** in-memory access token + httpOnly-cookie refresh, Bearer interceptor,
single-flight 401 refresh-and-retry (single-flight prevents a rotation race), real forms, real
`useAuth`/`AuthContext`, middleware gated on the refresh cookie, `/api` prefix normalized.

### P2 — Admin/seller screens missing or stubs
Built: payouts (approve/reject/requeue), disputes (resolve refund/release/split), fraud flags,
audit log, seller payout status. Added `GET /api/admin/fraud-flags` (the model was written to but
had no read route). **Contract findings:** `/admin/disputes` returns `{ disputes, pagination }` and
`/admin/audit-log` returns `{ logs, pagination }` — *not* the `{ data, meta }` used elsewhere.
Requeue is gated to `cancelled` only (the backend 409s on `failed` by design).

### P2 — Documentation drift
README phase table claimed Phase 1 "In progress"; listed endpoints that don't exist
(`/trades/:id/cancel`, `/mpesa/callback`, `/admin/overview`, …). Swagger documented 1 of ~45 endpoints.
`PROJECT_CONTEXT` claimed Phase 7 was "UNCOMMITTED on phase-6". **All reconciled.** `/api/ai` legacy
issue marked resolved (already migrated in commit `3dc2114`).

### P2 — Git hygiene
`C:\Users\LENOVO\.git` is an empty repo (0 commits, 0 tracked files — no leaked secrets) that shadows the
project root; `Documents/socialescrow/.git` is a headless failed init. The stale
`complete-auth-admin-phase1` branch is an **older backend fork** (27,043 deletions vs `phase-7`, no
`client/`), worth nothing.

---

## 3. Open items / decisions

1. **Next.js critical advisory remains.** `npm audit` wants **next@16.4.2** (semver-major). We are on the
   patched 14.2.35 line, which cleared the earlier criticals, but one advisory's fix is 16-only.
   *Decision needed: plan a Next 16 migration, or accept and document the residual risk.*
2. **Server breaking majors deferred:** `nodemailer` 6→10 (real SMTP-injection highs — highest priority),
   `uuid` 9→14, `bullmq` 3→6. Documented in README as deferred; each needs call-site review.
3. **No seller-scoped payout endpoint.** The seller screen is built from the wallet + ledger. A dedicated
   endpoint would give a true payout-request list.
4. **Vertical slice not yet run against real M-Pesa.** Requires Daraja sandbox credentials, an HTTPS
   callback tunnel, Redis, and a replica-set Mongo. The code path is now tested end-to-end in memory,
   but "a real shilling moved" is still unproven.
5. **Auth smoke test in a browser** was not run (build + type-check pass; runtime session flow unexercised).
6. **`window.confirm/prompt`** used for payout approve/reject and dispute resolution — functional, not styled.
7. **Git cleanup** flagged but not performed (awaiting your go-ahead).

---

## 4. Readiness

| Dimension | Before | Now |
|---|---|---|
| Builds | ✗ | ✓ |
| Auth | ✗ | ✓ (client wired) |
| Money path | dead-ends | ✓ coded + tested |
| Admin ops | 3 of 8 real | 8 of 8 real |
| Tests | 120 (disjoint) | 135 incl. vault/confirm |
| Docs | badly drifted | reconciled |
| Real-money validation | none | **still pending** |

**Honest score: ~7/10.** The product is now technically end-to-end on paper and in tests. It is not
yet proven against the actual payment rail, and that remains the single highest-value next step.
