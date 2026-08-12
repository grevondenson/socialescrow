/**
 * Phase 6 — dispute resolution + real-time chat (backend) regression suite.
 *
 * Uses a single-node MongoMemoryReplSet because raiseDispute / resolveDispute run
 * inside Mongo multi-document transactions (a standalone MongoMemoryServer can't).
 * Socket.io is NOT initialised under NODE_ENV=test, so emitToTrade() is a harmless
 * no-op — these tests assert the durable DB/HTTP effects, which are the source of truth.
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
const EscrowRecord = require('../src/models/EscrowRecord.model');
const PlatformAccount = require('../src/models/PlatformAccount.model');
const Dispute = require('../src/models/Dispute.model');
const Message = require('../src/models/Message.model');

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
 * Seeds a trade already in `paid` status with escrow locked, plus buyer/seller/admin
 * accounts with valid access tokens. Drives payment through the real mock-payment
 * transaction path so wallets, ledger, escrow and PlatformAccount are all consistent.
 */
const seedPaidTrade = async ({ amountKes = 1000 } = {}) => {
  const buyer = await registerUser('buyer');
  const seller = await registerUser('seller');
  const admin = await registerUser('admin');
  await User.findByIdAndUpdate(admin.user._id, { role: 'admin' });

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

  return { buyer, seller, admin, listing, trade, amountKes, platformFeeKes, sellerPayoutKes };
};

const raiseDispute = async (tradeId, token, reason = 'not as described') => {
  const res = await request(app)
    .post(`/api/trades/${tradeId}/dispute`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason });
  return res;
};

const resolve = (disputeId, token, body) =>
  request(app)
    .patch(`/api/admin/disputes/${disputeId}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── Dispute lifecycle ─────────────────────────────────────────────────────────
describe('Dispute lifecycle', () => {
  it('buyer raises a dispute on a paid trade → freezes escrow', async () => {
    const { buyer, trade } = await seedPaidTrade();

    const res = await raiseDispute(trade._id, buyer.token);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');

    expect((await Trade.findById(trade._id)).status).toBe('disputed');
    expect((await EscrowRecord.findOne({ trade: trade._id })).status).toBe('frozen');
    expect(await Dispute.countDocuments({ trade: trade._id, status: 'open' })).toBe(1);
    expect(await Message.countDocuments({ trade: trade._id, type: 'system' })).toBeGreaterThanOrEqual(1);
  });

  it('rejects a second open dispute for the same trade', async () => {
    const { buyer, seller, trade } = await seedPaidTrade();
    await raiseDispute(trade._id, buyer.token);

    const res = await raiseDispute(trade._id, seller.token);
    expect(res.status).toBe(400); // trade is no longer 'paid' → state guard
    expect((await Trade.findById(trade._id)).status).toBe('disputed');
  });

  it('rejects a dispute from a non-participant', async () => {
    const { trade } = await seedPaidTrade();
    const stranger = await registerUser('stranger');

    const res = await raiseDispute(trade._id, stranger.token);
    expect(res.status).toBe(403);
    expect((await Trade.findById(trade._id)).status).toBe('paid');
  });

  it('rejects a dispute with no reason', async () => {
    const { buyer, trade } = await seedPaidTrade();
    const res = await request(app)
      .post(`/api/trades/${trade._id}/dispute`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('blocks the seller from releasing credentials once disputed', async () => {
    const { buyer, seller, trade } = await seedPaidTrade();
    await raiseDispute(trade._id, buyer.token);

    const res = await request(app)
      .patch(`/api/trades/${trade._id}/release`)
      .set('Authorization', `Bearer ${seller.token}`);

    expect(res.status).not.toBe(200);
    expect((await Trade.findById(trade._id)).status).toBe('disputed');
  });
});

// ── Admin resolution ───────────────────────────────────────────────────────────
describe('Admin dispute resolution', () => {
  it('refund_to_buyer → buyer refunded gross, trade cancelled', async () => {
    const { buyer, admin, trade, amountKes } = await seedPaidTrade();
    const raised = await raiseDispute(trade._id, buyer.token);

    const res = await resolve(raised.body._id, admin.token, { resolution: 'refund_to_buyer' });
    expect(res.status).toBe(200);

    const buyerWallet = await Wallet.findOne({ user: buyer.user._id });
    expect(buyerWallet.availableBalance).toBe(amountKes);
    expect(buyerWallet.lockedInEscrow).toBe(0);
    expect((await EscrowRecord.findOne({ trade: trade._id })).status).toBe('refunded');
    expect((await Trade.findById(trade._id)).status).toBe('cancelled');
    expect((await Dispute.findById(raised.body._id)).status).toBe('resolved');
  });

  it('release_to_seller → seller paid out, platform keeps fee, trade completed', async () => {
    const { buyer, seller, admin, trade, platformFeeKes, sellerPayoutKes } = await seedPaidTrade();
    const raised = await raiseDispute(trade._id, buyer.token);

    const res = await resolve(raised.body._id, admin.token, { resolution: 'release_to_seller' });
    expect(res.status).toBe(200);

    const sellerWallet = await Wallet.findOne({ user: seller.user._id });
    expect(sellerWallet.pendingPayout).toBe(sellerPayoutKes);
    const buyerWallet = await Wallet.findOne({ user: buyer.user._id });
    expect(buyerWallet.lockedInEscrow).toBe(0);

    const platform = await PlatformAccount.findOne({});
    expect(platform.revenueBalance).toBe(platformFeeKes);
    expect(platform.escrowPool).toBe(0);

    expect((await EscrowRecord.findOne({ trade: trade._id })).status).toBe('released');
    expect((await Trade.findById(trade._id)).status).toBe('completed');
    expect((await Dispute.findById(raised.body._id)).status).toBe('resolved');
  });

  it('split → deposit divided between buyer and seller, fee waived, trade completed', async () => {
    const { buyer, seller, admin, trade, amountKes } = await seedPaidTrade();
    const raised = await raiseDispute(trade._id, buyer.token);

    const buyerAmount = 400;
    const sellerAmount = amountKes - buyerAmount; // 600
    const res = await resolve(raised.body._id, admin.token, {
      resolution: 'split', buyerAmount, sellerAmount,
    });
    expect(res.status).toBe(200);

    const buyerWallet = await Wallet.findOne({ user: buyer.user._id });
    expect(buyerWallet.availableBalance).toBe(buyerAmount);
    expect(buyerWallet.lockedInEscrow).toBe(0);

    const sellerWallet = await Wallet.findOne({ user: seller.user._id });
    expect(sellerWallet.pendingPayout).toBe(sellerAmount);

    const platform = await PlatformAccount.findOne({});
    expect(platform.escrowPool).toBe(0);
    expect(platform.revenueBalance).toBe(0); // fee waived on splits

    expect((await Trade.findById(trade._id)).status).toBe('completed');
    expect((await Dispute.findById(raised.body._id)).status).toBe('resolved');
  });

  it('split with a mismatched sum → 400, dispute stays open', async () => {
    const { buyer, admin, trade } = await seedPaidTrade();
    const raised = await raiseDispute(trade._id, buyer.token);

    const res = await resolve(raised.body._id, admin.token, {
      resolution: 'split', buyerAmount: 400, sellerAmount: 500, // sum 900 != 1000
    });
    expect(res.status).toBe(400);

    expect((await Dispute.findById(raised.body._id)).status).toBe('open');
    expect((await EscrowRecord.findOne({ trade: trade._id })).status).toBe('frozen');
    expect((await Trade.findById(trade._id)).status).toBe('disputed');
  });

  it('rejects an unknown resolution type → 400', async () => {
    const { buyer, admin, trade } = await seedPaidTrade();
    const raised = await raiseDispute(trade._id, buyer.token);

    const res = await resolve(raised.body._id, admin.token, { resolution: 'give_it_to_me' });
    expect(res.status).toBe(400);
    expect((await Dispute.findById(raised.body._id)).status).toBe('open');
  });

  it('non-admin cannot resolve a dispute → 403', async () => {
    const { buyer, trade } = await seedPaidTrade();
    const raised = await raiseDispute(trade._id, buyer.token);

    const res = await resolve(raised.body._id, buyer.token, { resolution: 'refund_to_buyer' });
    expect(res.status).toBe(403);
    expect((await Dispute.findById(raised.body._id)).status).toBe('open');
  });

  it('lists open disputes for admins', async () => {
    const { buyer, admin, trade } = await seedPaidTrade();
    await raiseDispute(trade._id, buyer.token);

    const res = await request(app)
      .get('/api/admin/disputes')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.disputes.length).toBe(1);
    expect(res.body.pagination.total).toBe(1);
  });
});

// ── Real-time chat (REST persistence) ──────────────────────────────────────────
describe('Trade chat messages', () => {
  it('a participant can post and read messages in order', async () => {
    const { buyer, seller, trade } = await seedPaidTrade();

    const post1 = await request(app)
      .post(`/api/trades/${trade._id}/messages`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ content: 'Hi, is this still available?' });
    expect(post1.status).toBe(201);
    expect(post1.body.content).toBe('Hi, is this still available?');

    const post2 = await request(app)
      .post(`/api/trades/${trade._id}/messages`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ content: 'Yes it is.' });
    expect(post2.status).toBe(201);

    const list = await request(app)
      .get(`/api/trades/${trade._id}/messages`)
      .set('Authorization', `Bearer ${buyer.token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    expect(list.body[0].content).toBe('Hi, is this still available?');
    expect(list.body[1].content).toBe('Yes it is.');
  });

  it('rejects an empty message → 400', async () => {
    const { buyer, trade } = await seedPaidTrade();
    const res = await request(app)
      .post(`/api/trades/${trade._id}/messages`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-participant reading or posting → 403', async () => {
    const { trade } = await seedPaidTrade();
    const stranger = await registerUser('stranger');

    const post = await request(app)
      .post(`/api/trades/${trade._id}/messages`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ content: 'let me in' });
    expect(post.status).toBe(403);

    const list = await request(app)
      .get(`/api/trades/${trade._id}/messages`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(list.status).toBe(403);
  });
});
