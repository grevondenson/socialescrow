/**
 * Credential vault + STK-push initiation.
 *
 * Both had ZERO coverage before this file. They matter because they sit on opposite sides of the
 * escrow: the vault is where the seller's goods actually live, and STK push is how money enters.
 *
 * Vault: envelope encryption (per-record data key wrapped by a master key). The tests round-trip
 * the plaintext through real submit/reveal HTTP calls and assert the double-reveal fraud path.
 * STK: the outbound Daraja call is mocked — no network — and we assert the response does not
 * leak the checkout request id (a deliberate anti-forgery measure).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
process.env.VAULT_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.REDIS_URL = '';

const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app } = require('../src/index');

const User = require('../src/models/User.model');
const Listing = require('../src/models/Listing.model');
const Trade = require('../src/models/Trade.model');
const CredentialVault = require('../src/models/CredentialVault.model');
const FraudFlag = require('../src/models/FraudFlag.model');
const MpesaTransaction = require('../src/models/MpesaTransaction.model');
const mpesaService = require('../src/services/mpesa.service');

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
const PLAINTEXT = 'username: hunter2 — do not share';

const registerUser = async (label) => {
  const email = `${label}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({
    fullName: `User ${label}`,
    email,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  });
  expect(res.status).toBe(201);
  // Vault submission sits behind requireVerifiedEmail — fixtures must be verified to exercise it.
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { isVerified: true } },
    { new: true }
  );
  return { token: res.body.accessToken, user };
};

const seedPaidTrade = async ({ amountKes = 1000, status = 'paid' } = {}) => {
  const buyer = await registerUser('buyer');
  const seller = await registerUser('seller');

  const listing = await Listing.create({
    seller: seller.user._id, platform: 'Instagram', followers: 1000, niche: 'lifestyle', priceKes: amountKes,
  });

  const platformFeeKes = Math.round(amountKes * 0.06);
  const trade = await Trade.create({
    listing: listing._id,
    buyer: buyer.user._id,
    seller: seller.user._id,
    amountKes,
    platformFeeKes,
    sellerPayoutKes: amountKes - platformFeeKes,
    status,
  });

  return { buyer, seller, listing, trade };
};

const submit = (tradeId, token, credentials = PLAINTEXT) =>
  request(app).post(`/api/trades/${tradeId}/vault`).set('Authorization', `Bearer ${token}`).send({ credentials });

const reveal = (tradeId, token) =>
  request(app).get(`/api/trades/${tradeId}/vault/reveal`).set('Authorization', `Bearer ${token}`);

// ── Vault: submit ─────────────────────────────────────────────────────────────

describe('POST /api/trades/:id/vault', () => {
  it('lets the seller store credentials while the trade is paid', async () => {
    const { seller, trade } = await seedPaidTrade();

    const res = await submit(trade._id, seller.token);
    expect(res.status).toBe(200);

    // Fetch with the select:false fields explicitly so we can inspect what was stored.
    const vault = await CredentialVault.findOne({ trade: trade._id })
      .select('+encryptedCredentials +iv +authTag +encryptedDataKey +encryptedDataKeyIv +keyAuthTag');

    expect(vault).toBeTruthy();
    expect(vault.revealed).toBe(false);
    // The stored blob must NOT be the plaintext.
    expect(vault.encryptedCredentials).not.toBe(PLAINTEXT);
    expect(vault.encryptedCredentials).not.toContain('hunter2');
  });

  it('rejects a buyer trying to submit credentials', async () => {
    const { buyer, trade } = await seedPaidTrade();
    const res = await submit(trade._id, buyer.token);
    expect(res.status).toBe(403);
    expect(await CredentialVault.countDocuments({ trade: trade._id })).toBe(0);
  });

  it('rejects submission before the trade is paid', async () => {
    const { seller, trade } = await seedPaidTrade({ status: 'payment_window' });
    const res = await submit(trade._id, seller.token);
    expect(res.status).toBe(400);
  });
});

// ── Vault: reveal ────────────────────────────────────────────────────────────

describe('GET /api/trades/:id/vault/reveal', () => {
  const seedReleased = async () => {
    const seeded = await seedPaidTrade();
    expect((await submit(seeded.trade._id, seeded.seller.token)).status).toBe(200);
    await Trade.findByIdAndUpdate(seeded.trade._id, { status: 'credentials_released' });
    return seeded;
  };

  it('returns the exact original plaintext to the buyer', async () => {
    const { buyer, trade } = await seedReleased();

    const res = await reveal(trade._id, buyer.token);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toBe(PLAINTEXT);
  });

  it('rejects the seller (only the buyer may reveal)', async () => {
    const { seller, trade } = await seedReleased();
    const res = await reveal(trade._id, seller.token);
    expect(res.status).toBe(403);
  });

  it('rejects reveal before credentials are released', async () => {
    const { buyer, trade } = await seedPaidTrade(); // still 'paid'
    const res = await reveal(trade._id, buyer.token);
    expect(res.status).toBe(400);
  });

  it('a second reveal is refused and raises a VAULT_DOUBLE_REVEAL fraud flag', async () => {
    const { buyer, trade } = await seedReleased();

    expect((await reveal(trade._id, buyer.token)).status).toBe(200);

    const second = await reveal(trade._id, buyer.token);
    expect(second.status).toBe(410);

    const flags = await FraudFlag.find({ trade: trade._id, flagType: 'VAULT_DOUBLE_REVEAL' });
    expect(flags).toHaveLength(1);
    expect(flags[0].riskLevel).toBe('high');
    expect(flags[0].riskScore).toBe(80);
  });
});

// ── STK-push initiation ──────────────────────────────────────────────────────

describe('POST /api/mpesa/stk-push', () => {
  const mockDaraja = (checkoutRequestId = 'ws_CO_TEST_123') => {
    jest.spyOn(mpesaService, 'getOAuthToken').mockResolvedValue('fake-access-token');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ResponseCode: '0',
        CheckoutRequestID: checkoutRequestId,
        MerchantRequestID: 'merchant-test-1',
        ResponseDescription: 'Success. Request accepted for processing',
      }),
    });
  };

  it('requires authentication', async () => {
    const { trade } = await seedPaidTrade({ status: 'payment_window' });
    const res = await request(app).post('/api/mpesa/stk-push').send({ tradeId: trade._id, phoneNumber: '0712345678' });
    expect(res.status).toBe(401);
  });

  it('requires tradeId and phoneNumber', async () => {
    const { buyer } = await seedPaidTrade({ status: 'payment_window' });
    const res = await request(app)
      .post('/api/mpesa/stk-push')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('initiates the push, persists a transaction, and never leaks the checkout id', async () => {
    process.env.MPESA_SHORTCODE = '174379';
    process.env.MPESA_PASSKEY = 'test-passkey';
    process.env.MPESA_CALLBACK_URL = 'https://example.com/api/mpesa/webhook/stk-push';

    const { buyer, trade } = await seedPaidTrade({ status: 'payment_window' });
    mockDaraja('ws_CO_SECRET_999');

    const res = await request(app)
      .post('/api/mpesa/stk-push')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ tradeId: trade._id, phoneNumber: '0712345678' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.transactionId).toBeTruthy();
    expect(res.body.tradeId).toBe(String(trade._id));

    // Anti-forgery: the client must not learn the checkout id it could use to forge a callback.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('ws_CO_SECRET_999');
    expect(body).not.toContain('merchant-test-1');
    expect(res.body.checkoutRequestId).toBeUndefined();

    // Persisted for the webhook/status-poll to find.
    const txn = await MpesaTransaction.findOne({ trade: trade._id });
    expect(txn).toBeTruthy();
    expect(txn.checkoutRequestId).toBe('ws_CO_SECRET_999');
    expect(txn.amountKes).toBe(trade.amountKes);
  });
});
