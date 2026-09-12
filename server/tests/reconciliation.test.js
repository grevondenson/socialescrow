/**
 * Pre-Phase 7 — ledger ↔ wallet reconciliation regression suite.
 *
 * Guards the money invariant that Phase 7's B2C payouts depend on:
 *
 *   expected = sum(CREDIT_TYPES) - sum(DEBIT_TYPES)
 *   actual   = availableBalance + lockedInEscrow + pendingPayout
 *   delta    = 0  for every escrow path
 *
 * Two bugs are covered here:
 *   1. reconcileWallet() aggregated on `wallet._id`, but LedgerEntry.user is a ref to
 *      User. The two ObjectIds never match, so both aggregates returned empty and
 *      `expected` was always 0 — every funded wallet reported a false mismatch and
 *      wrote a RECONCILIATION_MISMATCH FraudFlag.
 *   2. SELLER_PAYOUT was classified as a debit but is written when pendingPayout
 *      INCREASES, and the actual B2C disbursement had no ledger type at all.
 *
 * Uses a single-node MongoMemoryReplSet because escrow settlement runs inside Mongo
 * multi-document transactions (a standalone MongoMemoryServer can't).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
process.env.REDIS_URL = '';

const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app } = require('../src/index');

const User = require('../src/models/User.model');
const Wallet = require('../src/models/Wallet.model');
const Listing = require('../src/models/Listing.model');
const Trade = require('../src/models/Trade.model');
const LedgerEntry = require('../src/models/LedgerEntry.model');
const FraudFlag = require('../src/models/FraudFlag.model');

const escrowService = require('../src/services/escrow.service');
const reconciliationService = require('../src/services/reconciliation.service');

jest.setTimeout(60000);

let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

afterEach(async () => {
  jest.restoreAllMocks();
  const { collections } = mongoose.connection;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// ── Fixtures ────────────────────────────────────────────────────────────────
const registerUser = async (label) => {
  const email = `${label}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    fullName: `User ${label}`,
    email,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  });
  expect(res.status).toBe(201);
  const user = await User.findOne({ email });
  return { token: res.body.accessToken, user };
};

/**
 * Seeds a trade in `paid` status with escrow locked, driven through the real
 * mock-payment transaction so wallet, ledger, escrow and PlatformAccount agree.
 */
const seedPaidTrade = async ({ amountKes = 1000 } = {}) => {
  const buyer = await registerUser('buyer');
  const seller = await registerUser('seller');

  const listing = await Listing.create({
    seller: seller.user._id, platform: 'Instagram', followers: 1000, niche: 'lifestyle', priceKes: amountKes,
  });

  const platformFeeKes = Math.round(amountKes * 0.06);
  const sellerPayoutKes = amountKes - platformFeeKes;
  const trade = await Trade.create({
    listing: listing._id,
    buyer: buyer.user._id,
    seller: seller.user._id,
    amountKes,
    platformFeeKes,
    sellerPayoutKes,
    status: 'payment_window',
  });

  const payRes = await request(app)
    .patch(`/api/trades/${trade._id}/mock-payment`)
    .set('Authorization', `Bearer ${buyer.token}`);
  expect(payRes.status).toBe(200);

  return { buyer, seller, trade, amountKes, platformFeeKes, sellerPayoutKes };
};

/** Runs an escrow service call inside its own transaction, as the controllers do. */
const inTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => { await fn(session); });
  } finally {
    session.endSession();
  }
};

/**
 * Simulates what Phase 7's walletService.debitPendingPayout() will do on a confirmed
 * B2C disbursement: drain pendingPayout and write the WITHDRAWAL ledger entry.
 */
const simulateWithdrawal = async (userId, amountKes, tradeId) => {
  const before = await Wallet.findOneAndUpdate(
    { user: userId, pendingPayout: { $gte: amountKes } },
    { $inc: { pendingPayout: -amountKes } },
    { new: false }
  );
  if (!before) throw new Error('pendingPayout too low to withdraw');

  await LedgerEntry.create({
    trade:         tradeId,
    user:          userId,
    type:          'WITHDRAWAL',
    amountKes,
    balanceBefore: before.pendingPayout,
    balanceAfter:  before.pendingPayout - amountKes,
    note:          'Simulated B2C disbursement',
  });
};

const reconcile = (userId) => reconciliationService.reconcileWallet(userId);

const expectBalanced = (result, expectedTotal) => {
  expect(result.expected).toBe(expectedTotal);
  expect(result.actual).toBe(expectedTotal);
  expect(result.delta).toBe(0);
  expect(result.isBalanced).toBe(true);
};

const mismatchFlagCount = () =>
  FraudFlag.countDocuments({ flagType: 'RECONCILIATION_MISMATCH' });

// ── The invariant, path by path ───────────────────────────────────────────────
describe('reconcileWallet — money invariant holds across every escrow path', () => {
  it('deposit + lock → buyer balanced, no fraud flag', async () => {
    const { buyer, amountKes } = await seedPaidTrade();

    // DEPOSIT credit 1000, ESCROW_LOCK neutral → all 1000 sits in lockedInEscrow
    expectBalanced(await reconcile(buyer.user._id), amountKes);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('release → buyer nets to zero, seller holds the net payout', async () => {
    const { buyer, seller, trade, sellerPayoutKes } = await seedPaidTrade();
    await Trade.findByIdAndUpdate(trade._id, { status: 'credentials_released' });

    await inTransaction((session) => escrowService.release(trade._id.toString(), session));

    // Buyer: DEPOSIT 1000 - ESCROW_RELEASE 1000 (gross) = 0
    expectBalanced(await reconcile(buyer.user._id), 0);
    // Seller: SELLER_PAYOUT 940 credit; PLATFORM_FEE 60 excluded (revenue lives in PlatformAccount)
    expectBalanced(await reconcile(seller.user._id), sellerPayoutKes);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('release then WITHDRAWAL → seller nets to zero (the Phase 7 close-out)', async () => {
    const { buyer, seller, trade, sellerPayoutKes } = await seedPaidTrade();
    await Trade.findByIdAndUpdate(trade._id, { status: 'credentials_released' });
    await inTransaction((session) => escrowService.release(trade._id.toString(), session));

    await simulateWithdrawal(seller.user._id, sellerPayoutKes, trade._id);

    expectBalanced(await reconcile(seller.user._id), 0);
    expectBalanced(await reconcile(buyer.user._id), 0);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('refund → buyer balanced (REFUND is a neutral bucket move)', async () => {
    const { buyer, trade, amountKes } = await seedPaidTrade();

    await inTransaction((session) => escrowService.refund(trade._id.toString(), session));

    // DEPOSIT 1000, REFUND neutral → 1000 back in availableBalance
    expectBalanced(await reconcile(buyer.user._id), amountKes);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('freeze → buyer balanced (DISPUTE_HOLD moves no money)', async () => {
    const { buyer, trade, amountKes } = await seedPaidTrade();

    await inTransaction((session) => escrowService.freeze(trade._id.toString(), session));

    expectBalanced(await reconcile(buyer.user._id), amountKes);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('split → both sides balanced on their own share', async () => {
    const { buyer, seller, trade, amountKes } = await seedPaidTrade();
    await inTransaction((session) => escrowService.freeze(trade._id.toString(), session));

    const buyerAmount = 400;
    const sellerAmount = amountKes - buyerAmount; // 600
    await inTransaction((session) =>
      escrowService.split(trade._id.toString(), buyerAmount, sellerAmount, session));

    // Buyer: DEPOSIT 1000 - ESCROW_RELEASE 600 (seller's share only) = 400
    expectBalanced(await reconcile(buyer.user._id), buyerAmount);
    // Seller: SELLER_PAYOUT 600, fee waived on splits
    expectBalanced(await reconcile(seller.user._id), sellerAmount);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('split then WITHDRAWAL → seller nets to zero, buyer keeps their refund', async () => {
    const { buyer, seller, trade, amountKes } = await seedPaidTrade();
    await inTransaction((session) => escrowService.freeze(trade._id.toString(), session));

    const buyerAmount = 400;
    const sellerAmount = amountKes - buyerAmount;
    await inTransaction((session) =>
      escrowService.split(trade._id.toString(), buyerAmount, sellerAmount, session));

    await simulateWithdrawal(seller.user._id, sellerAmount, trade._id);

    expectBalanced(await reconcile(seller.user._id), 0);
    expectBalanced(await reconcile(buyer.user._id), buyerAmount);
    expect(await mismatchFlagCount()).toBe(0);
  });
});

// ── The fix must not be blind ─────────────────────────────────────────────────
describe('reconcileWallet — still detects a real mismatch', () => {
  it('a wallet credited outside the ledger is flagged', async () => {
    const { buyer, amountKes } = await seedPaidTrade();
    expectBalanced(await reconcile(buyer.user._id), amountKes);

    // Money appears with no matching ledger entry — exactly what reconciliation is for
    await Wallet.findOneAndUpdate({ user: buyer.user._id }, { $inc: { availableBalance: 500 } });

    const result = await reconcile(buyer.user._id);
    expect(result.isBalanced).toBe(false);
    expect(result.expected).toBe(amountKes);
    expect(result.actual).toBe(amountKes + 500);
    expect(result.delta).toBe(-500);
    expect(await mismatchFlagCount()).toBe(1);
  });

  it('a ledger entry with no matching wallet movement is flagged', async () => {
    const { buyer, amountKes } = await seedPaidTrade();

    await LedgerEntry.create({
      trade: null, user: buyer.user._id, type: 'DEPOSIT',
      amountKes: 750, balanceBefore: 0, balanceAfter: 750, note: 'phantom credit',
    });

    const result = await reconcile(buyer.user._id);
    expect(result.isBalanced).toBe(false);
    expect(result.expected).toBe(amountKes + 750);
    expect(result.delta).toBe(750);
    expect(await mismatchFlagCount()).toBe(1);
  });
});

// ── Model + endpoint wiring ───────────────────────────────────────────────────
describe('Phase 7 prerequisites', () => {
  it('LedgerEntry accepts the WITHDRAWAL type', async () => {
    const { seller } = await seedPaidTrade();
    const entry = await LedgerEntry.create({
      user: seller.user._id, type: 'WITHDRAWAL',
      amountKes: 100, balanceBefore: 100, balanceAfter: 0,
    });
    expect(entry.type).toBe('WITHDRAWAL');
  });

  it('rejects an unknown ledger type', async () => {
    const { seller } = await seedPaidTrade();
    await expect(LedgerEntry.create({
      user: seller.user._id, type: 'PAYOUT_SENT',
      amountKes: 100, balanceBefore: 100, balanceAfter: 0,
    })).rejects.toThrow();
  });

  it('GET /api/wallet/reconcile reports a balanced wallet', async () => {
    const { buyer, amountKes } = await seedPaidTrade();

    const res = await request(app)
      .get('/api/wallet/reconcile')
      .set('Authorization', `Bearer ${buyer.token}`);

    expect(res.status).toBe(200);
    expect(res.body.isBalanced).toBe(true);
    expect(res.body.expected).toBe(amountKes);
    expect(res.body.delta).toBe(0);
    expect(await mismatchFlagCount()).toBe(0);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/wallet/reconcile');
    expect(res.status).toBe(401);
  });
});
