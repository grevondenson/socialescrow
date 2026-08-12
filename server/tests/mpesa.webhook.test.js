/**
 * M-Pesa webhook hardening regression suite.
 *
 * Uses a single-node MongoMemoryReplSet for the whole file because the happy-path
 * settlement runs inside a Mongo multi-document transaction (which a standalone
 * MongoMemoryServer cannot do). The forgery/validation tests that return before
 * opening a transaction run fine against the same replica set.
 *
 * Daraja is never contacted: `queryStkStatus` (the anti-forgery re-query) is spied
 * per-test, and REDIS_URL is blanked so the BullMQ worker no-ops.
 */

// Must be set BEFORE requiring the app: blanks (not deletes) so dotenv.config()
// inside index.js won't repopulate them from a real .env.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
process.env.REDIS_URL = '';
process.env.MPESA_ALLOWED_IPS = '';            // empty → allowlist bypasses in non-prod
process.env.MPESA_REQUIRE_QUERY_CONFIRM = 'true';

const request = require('supertest');
const express = require('express');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app } = require('../src/index');
const mpesaService = require('../src/services/mpesa.service');
const { mpesaIpAllowlist } = require('../src/middleware/mpesaIpAllowlist.middleware');

const User = require('../src/models/User.model');
const Wallet = require('../src/models/Wallet.model');
const Listing = require('../src/models/Listing.model');
const Trade = require('../src/models/Trade.model');
const MpesaTransaction = require('../src/models/MpesaTransaction.model');
const FraudFlag = require('../src/models/FraudFlag.model');
const EscrowRecord = require('../src/models/EscrowRecord.model');
const LedgerEntry = require('../src/models/LedgerEntry.model');

jest.setTimeout(60000);

let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Ensure the new unique indexes (mpesaReceiptNumber, manualPayment.referenceCode) exist.
  await MpesaTransaction.init();
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
let uid = 0;
const makeUser = async (role = 'buyer') => {
  uid += 1;
  return User.create({
    fullName: `User ${uid}`,
    email: `user${uid}_${Math.random().toString(36).slice(2)}@example.com`,
    password: 'hashed-placeholder',
    role,
  });
};

const makeTradeFixture = async ({ amountKes = 1000 } = {}) => {
  const buyer = await makeUser('buyer');
  const seller = await makeUser('seller');
  await Wallet.create({ user: buyer._id, availableBalance: 0 });
  await Wallet.create({ user: seller._id });
  const listing = await Listing.create({
    seller: seller._id, platform: 'Instagram', followers: 1000, niche: 'lifestyle', priceKes: amountKes,
  });
  const platformFeeKes = Math.round(amountKes * 0.06);
  const trade = await Trade.create({
    listing: listing._id,
    buyer: buyer._id,
    seller: seller._id,
    amountKes,
    platformFeeKes,
    sellerPayoutKes: amountKes - platformFeeKes,
    status: 'payment_window',
  });
  return { buyer, seller, listing, trade };
};

const makePendingStkTxn = (trade, buyer, checkoutRequestId) =>
  MpesaTransaction.create({
    trade: trade._id,
    user: buyer._id,
    checkoutRequestId,
    merchantRequestId: `M-${checkoutRequestId}`,
    amountKes: trade.amountKes,
    phoneNumber: '254700000000',
    status: 'pending',
  });

const stkCallbackBody = ({
  checkoutRequestId,
  merchantRequestId,
  resultCode = 0,
  amount,
  receipt = 'RCPT-DEFAULT',
  phone = '254700000000',
}) => {
  const stkCallback = {
    MerchantRequestID: merchantRequestId || `M-${checkoutRequestId}`,
    CheckoutRequestID: checkoutRequestId,
    ResultCode: resultCode,
    ResultDesc: resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
  };
  if (resultCode === 0) {
    stkCallback.CallbackMetadata = {
      Item: [
        { Name: 'Amount', Value: amount },
        { Name: 'MpesaReceiptNumber', Value: receipt },
        { Name: 'PhoneNumber', Value: phone },
      ],
    };
  }
  return { Body: { stkCallback } };
};

const postWebhook = (body) => request(app).post('/api/mpesa/webhook/stk-push').send(body);

// ── Test matrix A–F ───────────────────────────────────────────────────────────
describe('POST /api/mpesa/webhook/stk-push — hardening', () => {
  // A. Forged callback, query says fail → not settled, FraudFlag created.
  it('A: does not settle when STK Query fails to confirm (forged callback)', async () => {
    const { trade, buyer } = await makeTradeFixture({ amountKes: 1000 });
    await makePendingStkTxn(trade, buyer, 'CR-A');
    const query = jest.spyOn(mpesaService, 'queryStkStatus').mockResolvedValue({ resultCode: 1, raw: { ResultCode: 1 } });

    const res = await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-A', amount: 1000, receipt: 'RCPT-A' }));

    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledWith('CR-A');
    const txn = await MpesaTransaction.findOne({ checkoutRequestId: 'CR-A' });
    expect(txn.status).toBe('pending');
    const freshTrade = await Trade.findById(trade._id);
    expect(freshTrade.status).toBe('payment_window');
    expect(await FraudFlag.countDocuments({ flagType: 'WEBHOOK_MISMATCH' })).toBe(1);
    const wallet = await Wallet.findOne({ user: buyer._id });
    expect(wallet.availableBalance).toBe(0);
    expect(wallet.lockedInEscrow).toBe(0);
  });

  // B. Non-zero ResultCode in the callback → txn failed, 200, query never called.
  it('B: marks the transaction failed on a non-zero callback ResultCode', async () => {
    const { trade, buyer } = await makeTradeFixture();
    await makePendingStkTxn(trade, buyer, 'CR-B');
    const query = jest.spyOn(mpesaService, 'queryStkStatus');

    const res = await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-B', resultCode: 1032 }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });
    expect(query).not.toHaveBeenCalled();
    const txn = await MpesaTransaction.findOne({ checkoutRequestId: 'CR-B' });
    expect(txn.status).toBe('failed');
    expect((await Trade.findById(trade._id)).status).toBe('payment_window');
  });

  // C. Unknown/duplicate txn → 200 'ignored', no settlement, no retry storm.
  it('C: acks (200) an unknown transaction so Daraja stops retrying', async () => {
    const res = await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-DOES-NOT-EXIST', amount: 1000 }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ignored' });
    expect(await MpesaTransaction.countDocuments({})).toBe(0);
  });

  // D. Amount mismatch (query ok) → not settled, FraudFlag. (transaction path → replica set)
  it('D: refuses to settle when callback amount != trade amount', async () => {
    const { trade, buyer } = await makeTradeFixture({ amountKes: 1000 });
    await makePendingStkTxn(trade, buyer, 'CR-D');
    jest.spyOn(mpesaService, 'queryStkStatus').mockResolvedValue({ resultCode: 0, raw: { ResultCode: 0 } });

    const res = await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-D', amount: 500, receipt: 'RCPT-D' }));

    expect(res.status).toBe(200);
    const txn = await MpesaTransaction.findOne({ checkoutRequestId: 'CR-D' });
    expect(txn.status).toBe('failed');
    expect((await Trade.findById(trade._id)).status).toBe('payment_window');
    expect(await FraudFlag.countDocuments({ flagType: 'WEBHOOK_MISMATCH' })).toBe(1);
    const wallet = await Wallet.findOne({ user: buyer._id });
    expect(wallet.availableBalance).toBe(0);
    expect(wallet.lockedInEscrow).toBe(0);
  });

  // E. Happy path → confirmed, trade paid, wallet credited + locked, escrow locked.
  it('E: settles a valid callback (IP ok + query 0 + amount match + fresh receipt)', async () => {
    const { trade, buyer } = await makeTradeFixture({ amountKes: 1000 });
    await makePendingStkTxn(trade, buyer, 'CR-E');
    jest.spyOn(mpesaService, 'queryStkStatus').mockResolvedValue({ resultCode: 0, raw: { ResultCode: 0 } });

    const res = await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-E', amount: 1000, receipt: 'RCPT-E' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });
    const txn = await MpesaTransaction.findOne({ checkoutRequestId: 'CR-E' });
    expect(txn.status).toBe('confirmed');
    expect(txn.mpesaReceiptNumber).toBe('RCPT-E');
    const freshTrade = await Trade.findById(trade._id);
    expect(freshTrade.status).toBe('paid');
    expect(freshTrade.mpesaRef).toBe('RCPT-E');
    const wallet = await Wallet.findOne({ user: buyer._id });
    expect(wallet.availableBalance).toBe(0);
    expect(wallet.lockedInEscrow).toBe(1000);
    const escrow = await EscrowRecord.findOne({ trade: trade._id });
    expect(escrow.status).toBe('locked');
  });

  // F. Replay: a second callback carrying an already-used receipt → E11000 handled, no double credit.
  it('F: rejects a replayed receipt via the unique index (no double credit)', async () => {
    jest.spyOn(mpesaService, 'queryStkStatus').mockResolvedValue({ resultCode: 0, raw: { ResultCode: 0 } });

    // First, a genuine settlement that claims receipt RCPT-DUP.
    const first = await makeTradeFixture({ amountKes: 1000 });
    await makePendingStkTxn(first.trade, first.buyer, 'CR-F1');
    await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-F1', amount: 1000, receipt: 'RCPT-DUP' }));
    expect((await MpesaTransaction.findOne({ checkoutRequestId: 'CR-F1' })).status).toBe('confirmed');

    // Now a second, different trade whose callback replays the SAME receipt.
    const second = await makeTradeFixture({ amountKes: 1000 });
    await makePendingStkTxn(second.trade, second.buyer, 'CR-F2');
    const res = await postWebhook(stkCallbackBody({ checkoutRequestId: 'CR-F2', amount: 1000, receipt: 'RCPT-DUP' }));

    expect(res.status).toBe(200);
    const txn2 = await MpesaTransaction.findOne({ checkoutRequestId: 'CR-F2' });
    expect(txn2.status).toBe('pending');            // not confirmed
    expect((await Trade.findById(second.trade._id)).status).toBe('payment_window');
    const wallet2 = await Wallet.findOne({ user: second.buyer._id });
    expect(wallet2.availableBalance).toBe(0);       // never credited
    expect(wallet2.lockedInEscrow).toBe(0);
    expect(await LedgerEntry.countDocuments({ trade: second.trade._id })).toBe(0);
    expect(await MpesaTransaction.countDocuments({ status: 'confirmed' })).toBe(1);
  });
});

// ── Manual payment amount validation (Step 3, manual path) ─────────────────────
describe('verifyManualPayment — admin-entered amount', () => {
  const makeSubmittedManual = async (trade, buyer, referenceCode) =>
    MpesaTransaction.create({
      trade: trade._id,
      user: buyer._id,
      amountKes: trade.amountKes,
      phoneNumber: '254700000000',
      status: 'pending',
      manualPayment: { referenceCode, status: 'submitted', submittedAt: new Date() },
    });

  it('settles when the admin-entered amount matches the trade amount', async () => {
    const { trade, buyer } = await makeTradeFixture({ amountKes: 1500 });
    const txn = await makeSubmittedManual(trade, buyer, 'REF-OK');

    const result = await mpesaService.verifyManualPayment(txn._id.toString(), true, 'looks good', buyer._id.toString(), 1500);

    expect(result.status).toBe('confirmed');
    expect(result.manualPayment.amountKes).toBe(1500);
    expect((await Trade.findById(trade._id)).status).toBe('paid');
    expect((await Wallet.findOne({ user: buyer._id })).lockedInEscrow).toBe(1500);
  });

  it('rejects + flags when the admin-entered amount does not match', async () => {
    const { trade, buyer } = await makeTradeFixture({ amountKes: 1500 });
    const txn = await makeSubmittedManual(trade, buyer, 'REF-BAD');

    await expect(
      mpesaService.verifyManualPayment(txn._id.toString(), true, 'wrong amount', buyer._id.toString(), 900)
    ).rejects.toThrow(/does not match/);

    const fresh = await MpesaTransaction.findById(txn._id);
    expect(fresh.status).toBe('failed');
    expect(fresh.manualPayment.status).toBe('rejected');
    expect((await Trade.findById(trade._id)).status).toBe('payment_window');
    expect(await FraudFlag.countDocuments({ flagType: 'WEBHOOK_MISMATCH' })).toBe(1);
    expect((await Wallet.findOne({ user: buyer._id })).lockedInEscrow).toBe(0);
  });
});

// ── IP allowlist middleware (trust proxy on) ───────────────────────────────────
describe('mpesaIpAllowlist middleware', () => {
  const buildApp = () => {
    const a = express();
    a.set('trust proxy', 1); // one proxy hop, like Railway
    a.use(express.json());
    a.post('/hook', mpesaIpAllowlist({ enforce: true, allowedIps: '196.201.214.200,196.201.213.0/24' }), (req, res) =>
      res.json({ ok: true, ip: req.ip })
    );
    return a;
  };

  it('allows an allowlisted source (exact match) via X-Forwarded-For', async () => {
    const res = await request(buildApp()).post('/hook').set('X-Forwarded-For', '196.201.214.200').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows a source inside an allowlisted CIDR block', async () => {
    const res = await request(buildApp()).post('/hook').set('X-Forwarded-For', '196.201.213.55').send({});
    expect(res.status).toBe(200);
  });

  it('rejects a non-allowlisted source with 403', async () => {
    const res = await request(buildApp()).post('/hook').set('X-Forwarded-For', '10.0.0.1').send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Forbidden source');
  });

  it('fails closed (403) in enforce mode when the allowlist is empty', async () => {
    const a = express();
    a.set('trust proxy', 1);
    a.post('/hook', mpesaIpAllowlist({ enforce: true, allowedIps: '' }), (req, res) => res.json({ ok: true }));
    const res = await request(a).post('/hook').set('X-Forwarded-For', '196.201.214.200').send({});
    expect(res.status).toBe(403);
  });
});
