/**
 * Confirm-receipt terminal path.
 *
 * Until this endpoint existed, `escrowService.release()` — the only thing that queues a seller
 * payout — was reachable ONLY from admin dispute resolution. A trade both parties were happy
 * with stalled at `credentials_released` forever and no money ever moved.
 *
 * Drill: buyer pays (mock) → seller submits vault → seller releases → BUYER confirms.
 * Asserts the full money movement: escrow released, seller credited, payout queued, trade completed.
 *
 * A single-node MongoMemoryReplSet is required because confirmReceipt (like raiseDispute) runs
 * inside a multi-document transaction.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
process.env.VAULT_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.REDIS_URL = '';

const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app } = require('../src/index');

const User = require('../src/models/User.model');
const Wallet = require('../src/models/Wallet.model');
const Listing = require('../src/models/Listing.model');
const Trade = require('../src/models/Trade.model');
const EscrowRecord = require('../src/models/EscrowRecord.model');
const PayoutQueue = require('../src/models/PayoutQueue.model');
const LedgerEntry = require('../src/models/LedgerEntry.model');
const AuditLog = require('../src/models/AuditLog.model');

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
  // Vault submission (and trade creation) sit behind requireVerifiedEmail, so a usable fixture
  // must be a verified user — hitting the verify endpoint too would only add noise here.
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { isVerified: true } },
    { new: true }
  );
  return { token: res.body.accessToken, user };
};

/**
 * Seeds a trade in `paid` status with escrow locked, driven through the real mock-payment
 * transaction so wallets, ledger, escrow and PlatformAccount are all consistent.
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

  return { buyer, seller, listing, trade, amountKes, platformFeeKes, sellerPayoutKes };
};

const submitVault = (tradeId, token) =>
  request(app)
    .post(`/api/trades/${tradeId}/vault`)
    .set('Authorization', `Bearer ${token}`)
    .send({ credentials: 'user:secret-pass' });

const releaseTrade = (tradeId, token) =>
  request(app).patch(`/api/trades/${tradeId}/release`).set('Authorization', `Bearer ${token}`);

const confirmTrade = (tradeId, token) =>
  request(app).patch(`/api/trades/${tradeId}/confirm`).set('Authorization', `Bearer ${token}`);

/** Drives a trade all the way to `credentials_released`. */
const seedReleasedTrade = async (opts = {}) => {
  const seeded = await seedPaidTrade(opts);
  expect((await submitVault(seeded.trade._id, seeded.seller.token)).status).toBe(200);
  expect((await releaseTrade(seeded.trade._id, seeded.seller.token)).status).toBe(200);

  const trade = await Trade.findById(seeded.trade._id);
  expect(trade.status).toBe('credentials_released');
  return { ...seeded, trade };
};

// ── Happy path ────────────────────────────────────────────────────────────────

describe('PATCH /api/trades/:id/confirm — happy path', () => {
  it('completes the trade, releases escrow, credits the seller and queues a payout', async () => {
    const { buyer, seller, trade, sellerPayoutKes } = await seedReleasedTrade({ amountKes: 1000 });

    const res = await confirmTrade(trade._id, buyer.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');

    // Trade terminal state — the state that was previously unreachable.
    const updated = await Trade.findById(trade._id);
    expect(updated.status).toBe('completed');

    // Escrow released.
    const escrow = await EscrowRecord.findOne({ trade: trade._id });
    expect(escrow.status).toBe('released');
    expect(escrow.releasedAt).toBeTruthy();

    // Buyer's locked funds returned to zero.
    const buyerWallet = await Wallet.findOne({ user: buyer.user._id });
    expect(buyerWallet.lockedInEscrow).toBe(0);

    // Seller credited in pendingPayout.
    const sellerWallet = await Wallet.findOne({ user: seller.user._id });
    expect(sellerWallet.pendingPayout).toBe(sellerPayoutKes);

    // A payout row exists, parked for admin approval (AUTO_PAYOUT is unset).
    const payouts = await PayoutQueue.find({ trade: trade._id });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe('pending_approval');
    expect(payouts[0].amountKes).toBe(sellerPayoutKes);

    // Ledger entries for both sides.
    expect(await LedgerEntry.countDocuments({ trade: trade._id, type: 'SELLER_PAYOUT' })).toBe(1);
    expect(await LedgerEntry.countDocuments({ trade: trade._id, type: 'ESCROW_RELEASE' })).toBe(1);

    // Audit trail.
    expect(await AuditLog.countDocuments({ action: 'trade_confirmed' })).toBe(1);
  });
});

// ── Authorization & state guards ─────────────────────────────────────────────

describe('PATCH /api/trades/:id/confirm — guards', () => {
  it('rejects the seller (only the buyer may release their own escrow)', async () => {
    const { seller, trade } = await seedReleasedTrade();
    const res = await confirmTrade(trade._id, seller.token);
    expect(res.status).toBe(403);

    const unchanged = await Trade.findById(trade._id);
    expect(unchanged.status).toBe('credentials_released');
    expect(await PayoutQueue.countDocuments({ trade: trade._id })).toBe(0);
  });

  it('rejects confirmation before the seller has released credentials', async () => {
    const { buyer, trade } = await seedPaidTrade(); // status 'paid', no vault/release
    const res = await confirmTrade(trade._id, buyer.token);
    expect(res.status).toBe(400);

    const unchanged = await Trade.findById(trade._id);
    expect(unchanged.status).toBe('paid');
  });

  it('requires authentication', async () => {
    const { trade } = await seedReleasedTrade();
    const res = await request(app).patch(`/api/trades/${trade._id}/confirm`);
    expect(res.status).toBe(401);
  });
});

// ── Double-spend protection ──────────────────────────────────────────────────

describe('PATCH /api/trades/:id/confirm — no double spend', () => {
  it('a second confirm cannot move money twice', async () => {
    const { buyer, trade, sellerPayoutKes } = await seedReleasedTrade();

    expect((await confirmTrade(trade._id, buyer.token)).status).toBe(200);
    const second = await confirmTrade(trade._id, buyer.token);
    expect(second.status).not.toBe(200);

    // Exactly one payout row and one SELLER_PAYOUT entry despite two attempts.
    expect(await PayoutQueue.countDocuments({ trade: trade._id })).toBe(1);

    const sellerWallet = await Wallet.findOne({ user: trade.seller });
    // If release had run twice this would be 2× — prove it is exactly one payouts' worth.
    expect(sellerWallet.pendingPayout).toBe(sellerPayoutKes);
    expect(await LedgerEntry.countDocuments({ trade: trade._id, type: 'SELLER_PAYOUT' })).toBe(1);
  });
});
