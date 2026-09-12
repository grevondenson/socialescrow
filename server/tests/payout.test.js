/**
 * Phase 7 — payout suite.
 *
 * Steps 1–2 scope: the PayoutQueue model contract, and queueing a payout on escrow
 * release/split.
 *
 * The unique indexes here ARE the double-disbursement backstop described in the plan, so
 * they're asserted directly rather than trusted — a `unique` that silently never built is
 * indistinguishable from a working one until the day two payouts fire for the same trade.
 *
 * Uses a single-node MongoMemoryReplSet (not a standalone server) because every settlement
 * path runs inside a Mongo multi-document transaction.
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
const PlatformAccount = require('../src/models/PlatformAccount.model');
const PayoutQueue = require('../src/models/PayoutQueue.model');
const AuditLog = require('../src/models/AuditLog.model');
const LedgerEntry = require('../src/models/LedgerEntry.model');

const escrowService = require('../src/services/escrow.service');
const payoutService = require('../src/services/payout.service');
const mpesaService = require('../src/services/mpesa.service');
const { reconcileWallet } = require('../src/services/reconciliation.service');

jest.setTimeout(60000);

let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Unique-index assertions are meaningless until the indexes actually exist.
  await PayoutQueue.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

afterEach(async () => {
  delete process.env.AUTO_PAYOUT;
  jest.restoreAllMocks();
  const { collections } = mongoose.connection;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// ── Fixtures ────────────────────────────────────────────────────────────────
const oid = () => new mongoose.Types.ObjectId();

/** A freshly queued payout, as escrow.service creates it. */
const queued = (overrides = {}) => ({
  trade:     oid(),
  seller:    oid(),
  amountKes: 940,
  ...overrides,
});

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

/** Seeds a trade in `paid` status with escrow locked, via the real mock-payment transaction. */
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

/** Captures the thrown error so its statusCode can be asserted. */
const captureError = async (promiseFn) => {
  try {
    await promiseFn();
  } catch (err) {
    return err;
  }
  throw new Error('Expected the call to throw, but it resolved');
};

const releaseTrade = async (trade) => {
  await Trade.findByIdAndUpdate(trade._id, { status: 'credentials_released' });
  await inTransaction((session) => escrowService.release(trade._id.toString(), session));
};

/** A registered user promoted to `admin` — `protect` re-reads the role, so the token still works. */
const asAdmin = async () => {
  const admin = await registerUser('admin');
  await User.findByIdAndUpdate(admin.user._id, { role: 'admin' });
  return admin;
};

const toggleBreaker = (admin, body) =>
  request(app)
    .patch('/api/admin/platform/circuit-breaker')
    .set('Authorization', `Bearer ${admin.token}`)
    .send(body);

// ── Daraja B2C fixtures (shared by the service and webhook suites) ──────────
const B2C_ENV = {
  MPESA_B2C_SHORTCODE:       '600999',
  MPESA_INITIATOR_NAME:      'testapi',
  MPESA_SECURITY_CREDENTIAL: 'pre-computed-encrypted-credential',
  MPESA_B2C_RESULT_URL:      'https://example.test/api/mpesa/webhook/b2c-result',
  MPESA_B2C_TIMEOUT_URL:     'https://example.test/api/mpesa/webhook/b2c-timeout',
};

const DARAJA_ACCEPTED = {
  ConversationID:           'AG_20260816_2010759fd5662ef6d054',
  OriginatorConversationID: '16740-34861180-1',
  ResponseCode:             '0',
  ResponseDescription:      'Accept the service request successfully.',
};

/** Stubs global fetch with one Daraja response. */
const darajaReplies = (body, { ok = true } = {}) => {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body });
};

/** Installs the B2C env + a happy Daraja for one describe block, and tears it down after. */
const useDarajaEnv = () => {
  beforeEach(() => {
    Object.assign(process.env, B2C_ENV);
    darajaReplies(DARAJA_ACCEPTED);
    jest.spyOn(mpesaService, 'getOAuthToken').mockResolvedValue('test-access-token');
  });

  afterEach(() => {
    for (const key of Object.keys(B2C_ENV)) delete process.env[key];
    delete global.fetch;
  });
};

/** A released trade whose payout an admin has approved, seller reachable on M-Pesa. */
const approvedPayout = async () => {
  const seeded = await seedPaidTrade();
  await User.findByIdAndUpdate(seeded.seller.user._id, { phone: '0712345678' });
  await releaseTrade(seeded.trade);
  const payout = await PayoutQueue.findOneAndUpdate(
    { trade: seeded.trade._id },
    { $set: { status: 'approved' } },
    { new: true }
  );
  return { ...seeded, payout };
};

/** ...and that Daraja has now accepted for processing. */
const processingPayout = async () => {
  const ctx = await approvedPayout();
  return { ...ctx, payout: await payoutService.sendB2C(ctx.payout._id) };
};

const b2cResult = (payout, { resultCode = 0, receipt = 'QK12ABC34D', withParams = true } = {}) => ({
  Result: {
    ResultType:               0,
    ResultCode:               resultCode,
    ResultDesc:               resultCode === 0
      ? 'The service request is processed successfully.'
      : 'The initiator information is invalid.',
    OriginatorConversationID: payout.originatorConversationId,
    ConversationID:           payout.conversationId,
    TransactionID:            receipt,
    ...(withParams && {
      ResultParameters: {
        ResultParameter: [
          { Key: 'TransactionReceipt', Value: receipt },
          { Key: 'TransactionAmount',  Value: payout.amountKes },
        ],
      },
    }),
  },
});

// ── Step 1: the model contract ───────────────────────────────────────────────
describe('PayoutQueue model', () => {
  it('defaults a new payout to pending_approval with no attempts', async () => {
    const payout = await PayoutQueue.create(queued());

    expect(payout.status).toBe('pending_approval');
    expect(payout.attempts).toBe(0);
    expect(payout.queuedAt).toBeInstanceOf(Date);
    expect(payout.createdAt).toBeInstanceOf(Date);
    expect(payout.sentAt).toBeUndefined();
    expect(payout.transactionReceipt).toBeUndefined();
  });

  it('rejects a status outside the lifecycle enum', async () => {
    await expect(PayoutQueue.create(queued({ status: 'paid' }))).rejects.toThrow();
  });

  it('rejects a second payout for the same trade (E11000)', async () => {
    const trade = oid();
    await PayoutQueue.create(queued({ trade }));

    await expect(PayoutQueue.create(queued({ trade }))).rejects.toThrow(/E11000/);
    expect(await PayoutQueue.countDocuments({ trade })).toBe(1);
  });

  it('allows many payouts with no Daraja ids yet (unique indexes are sparse)', async () => {
    // Every payout is created before B2C is called, so originatorConversationId and
    // transactionReceipt are unset on all of them. Without `sparse`, the second insert
    // would collide on a null key and no payout could ever be queued.
    await PayoutQueue.create(queued());
    await PayoutQueue.create(queued());
    await PayoutQueue.create(queued());

    expect(await PayoutQueue.countDocuments({})).toBe(3);
  });

  it('rejects a duplicate originatorConversationId (E11000)', async () => {
    await PayoutQueue.create(queued({ originatorConversationId: 'AG_20260816_ABC' }));

    await expect(PayoutQueue.create(queued({ originatorConversationId: 'AG_20260816_ABC' })))
      .rejects.toThrow(/E11000/);
  });

  it('rejects a duplicate transactionReceipt — a replayed Result callback cannot double-settle', async () => {
    await PayoutQueue.create(queued({ status: 'sent', transactionReceipt: 'QK12ABC34D' }));

    await expect(PayoutQueue.create(queued({ status: 'sent', transactionReceipt: 'QK12ABC34D' })))
      .rejects.toThrow(/E11000/);
  });
});

// ── Step 2: queueing on release ──────────────────────────────────────────────
describe('escrow release queues a payout', () => {
  it('queues pending_approval and credits pendingPayout without debiting it', async () => {
    const { seller, trade, sellerPayoutKes } = await seedPaidTrade();

    await releaseTrade(trade);

    const payout = await PayoutQueue.findOne({ trade: trade._id });
    expect(payout).not.toBeNull();
    expect(payout.status).toBe('pending_approval');
    expect(payout.amountKes).toBe(sellerPayoutKes); // net of the 6% fee
    expect(payout.seller.toString()).toBe(seller.user._id.toString());
    expect(payout.attempts).toBe(0);

    // Decision 3: the money is owed but not yet gone. pendingPayout drains only when
    // M-Pesa confirms the disbursement, so a failed payout stays retryable.
    const wallet = await Wallet.findOne({ user: seller.user._id });
    expect(wallet.pendingPayout).toBe(sellerPayoutKes);
    expect(await LedgerEntry.countDocuments({ user: seller.user._id, type: 'WITHDRAWAL' })).toBe(0);
  });

  it('writes a payout_queued audit entry attributed to the seller', async () => {
    const { seller, trade, sellerPayoutKes } = await seedPaidTrade();

    await releaseTrade(trade);

    const audit = await AuditLog.findOne({ action: 'payout_queued' });
    expect(audit).not.toBeNull();
    expect(audit.user.toString()).toBe(seller.user._id.toString());
    expect(audit.metadata.amountKes).toBe(sellerPayoutKes);
    expect(audit.metadata.status).toBe('pending_approval');
    expect(audit.metadata.autoPayout).toBe(false);
  });

  it('queues straight to approved when AUTO_PAYOUT=true', async () => {
    process.env.AUTO_PAYOUT = 'true';
    const { trade } = await seedPaidTrade();

    await releaseTrade(trade);

    const payout = await PayoutQueue.findOne({ trade: trade._id });
    expect(payout.status).toBe('approved');
    // No human approved it — an unset approvedBy is what distinguishes an auto-approval
    // from an admin one in the audit trail.
    expect(payout.approvedBy).toBeUndefined();
    expect(payout.approvedAt).toBeUndefined();
  });

  it('rolls the whole release back when a payout is already queued (409)', async () => {
    const { seller, trade, sellerPayoutKes } = await seedPaidTrade();
    // Pre-existing row — the unique-index backstop against paying a seller twice.
    await PayoutQueue.create(queued({ trade: trade._id, seller: seller.user._id, amountKes: sellerPayoutKes }));

    const err = await captureError(() => releaseTrade(trade));
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/already queued/);

    // Nothing settled: the transaction aborted, so the seller was never credited either.
    const wallet = await Wallet.findOne({ user: seller.user._id });
    expect(wallet.pendingPayout).toBe(0);
    expect((await Trade.findById(trade._id)).status).not.toBe('completed');
    expect(await PayoutQueue.countDocuments({ trade: trade._id })).toBe(1);
  });

  it('queues nothing when the circuit breaker is open (503)', async () => {
    const { seller, trade } = await seedPaidTrade();
    await PlatformAccount.findOneAndUpdate({}, { payoutsEnabled: false }, { upsert: true });

    const err = await captureError(() => releaseTrade(trade));
    expect(err.statusCode).toBe(503);

    expect(await PayoutQueue.countDocuments({})).toBe(0);
    const wallet = await Wallet.findOne({ user: seller.user._id });
    expect(wallet.pendingPayout).toBe(0);
  });
});

// ── Step 2: queueing on split ────────────────────────────────────────────────
describe('escrow split queues a payout', () => {
  const splitTrade = async (trade, buyerAmount, sellerAmount) => {
    await inTransaction((session) => escrowService.freeze(trade._id.toString(), session));
    await inTransaction((session) =>
      escrowService.split(trade._id.toString(), buyerAmount, sellerAmount, session));
  };

  it("queues the seller's share, fee waived", async () => {
    const { seller, trade, amountKes } = await seedPaidTrade();
    const sellerAmount = amountKes - 400;

    await splitTrade(trade, 400, sellerAmount);

    const payout = await PayoutQueue.findOne({ trade: trade._id });
    expect(payout.status).toBe('pending_approval');
    expect(payout.amountKes).toBe(sellerAmount); // 600, not 600 minus a fee
    expect(payout.seller.toString()).toBe(seller.user._id.toString());

    const wallet = await Wallet.findOne({ user: seller.user._id });
    expect(wallet.pendingPayout).toBe(sellerAmount);
  });

  it('queues nothing on a full refund to the buyer (sellerAmount 0)', async () => {
    const { trade, amountKes } = await seedPaidTrade();

    await splitTrade(trade, amountKes, 0);

    // An empty payout row would sit in the admin queue forever.
    expect(await PayoutQueue.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'payout_queued' })).toBe(0);
  });
});

// ── The payout kill switch, end to end ───────────────────────────────────────
// The existing 503 cases above flip `payoutsEnabled` directly on the model, so they pass
// even when the admin endpoint that flips it is broken. Phase 7 depends on an admin being
// able to actually stop payouts, so the switch is driven through the real endpoint here.
describe('platform circuit breaker', () => {
  it('trips the breaker and audits it', async () => {
    const admin = await asAdmin();

    const res = await toggleBreaker(admin, { action: 'trigger', reason: 'mismatch spike' });

    // Regression: `platform_circuit_breaker` was missing from the AuditLog enum, so this
    // audit write threw *after* PlatformAccount had already been updated. The breaker
    // flipped and the admin was told it had failed with a 500.
    expect(res.status).toBe(200);
    expect(res.body.payoutsEnabled).toBe(false);
    expect(res.body.circuitBreakerReason).toBe('mismatch spike');
    expect(await AuditLog.countDocuments({ action: 'platform_circuit_breaker' })).toBe(1);
  });

  it('stops a release from queuing once tripped', async () => {
    const admin = await asAdmin();
    const { trade } = await seedPaidTrade();

    expect((await toggleBreaker(admin, { action: 'trigger' })).status).toBe(200);

    const err = await captureError(() => releaseTrade(trade));
    expect(err.statusCode).toBe(503);
    expect(await PayoutQueue.countDocuments({})).toBe(0);
  });

  it('lets payouts resume once cleared', async () => {
    const admin = await asAdmin();
    const { trade, sellerPayoutKes } = await seedPaidTrade();
    await toggleBreaker(admin, { action: 'trigger' });

    const res = await toggleBreaker(admin, { action: 'clear' });
    expect(res.status).toBe(200);
    expect(res.body.payoutsEnabled).toBe(true);
    expect(res.body.circuitBreakerReason).toBeNull();

    await releaseTrade(trade);
    const payout = await PayoutQueue.findOne({ trade: trade._id });
    expect(payout.amountKes).toBe(sellerPayoutKes);
  });
});

// ── Step 3: the B2C disbursement ─────────────────────────────────────────────
describe('payout.service B2C', () => {
  useDarajaEnv();


  describe('sendB2C', () => {
    it('moves an approved payout to processing without paying anyone yet', async () => {
      const { seller, payout: approved, sellerPayoutKes } = await approvedPayout();

      const payout = await payoutService.sendB2C(approved._id);

      // ResponseCode '0' means Daraja accepted the request, not that the seller was paid.
      expect(payout.status).toBe('processing');
      expect(payout.sentAt).toBeUndefined();
      expect(payout.transactionReceipt).toBeUndefined();
      expect(payout.originatorConversationId).toBe(DARAJA_ACCEPTED.OriginatorConversationID);
      expect(payout.conversationId).toBe(DARAJA_ACCEPTED.ConversationID);
      expect(payout.attempts).toBe(1);

      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(sellerPayoutKes);
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
    });

    it('sends BusinessPayment to the B2C endpoint with the seller MSISDN', async () => {
      const { payout: approved, sellerPayoutKes } = await approvedPayout();

      await payoutService.sendB2C(approved._id);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toContain('/mpesa/b2c/v1/paymentrequest');
      expect(init.headers.Authorization).toBe('Bearer test-access-token');

      const body = JSON.parse(init.body);
      expect(body.CommandID).toBe('BusinessPayment');
      expect(body.PartyB).toBe('254712345678'); // normalized from 0712345678
      expect(body.PartyA).toBe(B2C_ENV.MPESA_B2C_SHORTCODE);
      expect(body.Amount).toBe(sellerPayoutKes);
      expect(body.SecurityCredential).toBe(B2C_ENV.MPESA_SECURITY_CREDENTIAL);
      expect(body.ResultURL).toBe(B2C_ENV.MPESA_B2C_RESULT_URL);
      expect(body.QueueTimeOutURL).toBe(B2C_ENV.MPESA_B2C_TIMEOUT_URL);
    });

    it('reaches Daraja once when two approvals race (CAS holds)', async () => {
      const { payout: approved } = await approvedPayout();

      const results = await Promise.allSettled([
        payoutService.sendB2C(approved._id),
        payoutService.sendB2C(approved._id),
      ]);

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.statusCode).toBe(409);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect((await PayoutQueue.findById(approved._id)).attempts).toBe(1);
    });

    it('refuses a payout that is still pending_approval (409)', async () => {
      // Built from an approved payout and reverted, so config and MSISDN are both valid and
      // the status CAS is the only thing that can refuse.
      const { payout: approved } = await approvedPayout();
      await PayoutQueue.findByIdAndUpdate(approved._id, { $set: { status: 'pending_approval' } });

      const err = await captureError(() => payoutService.sendB2C(approved._id));
      expect(err.statusCode).toBe(409);
      expect(global.fetch).not.toHaveBeenCalled();
      expect((await PayoutQueue.findById(approved._id)).status).toBe('pending_approval');
    });

    it('leaves the payout approved and retryable when the breaker is open (503)', async () => {
      const { payout: approved } = await approvedPayout();
      await PlatformAccount.findOneAndUpdate({}, { payoutsEnabled: false }, { upsert: true });

      const err = await captureError(() => payoutService.sendB2C(approved._id));
      expect(err.statusCode).toBe(503);

      // Checked before the CAS: nothing is stranded in `processing`.
      const payout = await PayoutQueue.findById(approved._id);
      expect(payout.status).toBe('approved');
      expect(payout.attempts).toBe(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('leaves the payout approved when the seller has no usable phone (400)', async () => {
      const { payout: approved, seller } = await approvedPayout();
      await User.findByIdAndUpdate(seller.user._id, { phone: '' });

      const err = await captureError(() => payoutService.sendB2C(approved._id));
      expect(err.statusCode).toBe(400);

      // An admin can add the phone number and re-approve; the payout is not stuck.
      expect((await PayoutQueue.findById(approved._id)).status).toBe('approved');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refuses to send when the B2C secrets are missing', async () => {
      const { payout: approved } = await approvedPayout();
      delete process.env.MPESA_SECURITY_CREDENTIAL;

      await expect(payoutService.sendB2C(approved._id)).rejects.toThrow(/B2C credentials/);
      expect((await PayoutQueue.findById(approved._id)).status).toBe('approved');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('marks the payout failed when Daraja rejects the request', async () => {
      const { payout: approved, seller, sellerPayoutKes } = await approvedPayout();
      darajaReplies({ ResponseCode: '2001', errorMessage: 'The initiator information is invalid.' });

      await expect(payoutService.sendB2C(approved._id)).rejects.toThrow(/initiator information/);

      // No Result callback is ever coming, so `processing` would be a permanent dead end.
      const payout = await PayoutQueue.findById(approved._id);
      expect(payout.status).toBe('failed');
      expect(payout.lastError).toMatch(/initiator information/);
      expect(await AuditLog.countDocuments({ action: 'payout_failed' })).toBe(1);

      // The seller is still owed the money.
      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(sellerPayoutKes);
    });
  });

  describe('processB2CResult', () => {
    it('settles the payout, drains pendingPayout and records the WITHDRAWAL', async () => {
      const { seller, trade, payout, sellerPayoutKes } = await processingPayout();

      const settled = await payoutService.processB2CResult(b2cResult(payout));

      expect(settled.status).toBe('sent');
      expect(settled.transactionReceipt).toBe('QK12ABC34D');
      expect(settled.sentAt).toBeInstanceOf(Date);

      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(0);

      const withdrawals = await LedgerEntry.find({ user: seller.user._id, type: 'WITHDRAWAL' });
      expect(withdrawals).toHaveLength(1);
      expect(withdrawals[0].amountKes).toBe(sellerPayoutKes);
      expect(withdrawals[0].balanceBefore).toBe(sellerPayoutKes);
      expect(withdrawals[0].balanceAfter).toBe(0);

      expect((await Trade.findById(trade._id)).payoutRef).toBe('QK12ABC34D');
      expect(await AuditLog.countDocuments({ action: 'payout_sent' })).toBe(1);
    });

    it("leaves the seller's wallet reconciled after a real disbursement", async () => {
      const { seller, payout } = await processingPayout();

      await payoutService.processB2CResult(b2cResult(payout));

      // SELLER_PAYOUT (credit) minus WITHDRAWAL (debit) must equal the emptied wallet.
      const report = await reconcileWallet(seller.user._id);
      expect(report.delta).toBe(0);
      expect(report.isBalanced).toBe(true);
    });

    it('falls back to Result.TransactionID when no parameter bag is sent', async () => {
      const { payout } = await processingPayout();

      const settled = await payoutService.processB2CResult(
        b2cResult(payout, { receipt: 'QKZ99XYZ01', withParams: false })
      );

      expect(settled.transactionReceipt).toBe('QKZ99XYZ01');
    });

    it('fails the payout on a non-zero ResultCode and keeps pendingPayout intact', async () => {
      const { seller, payout, sellerPayoutKes } = await processingPayout();

      const failed = await payoutService.processB2CResult(b2cResult(payout, { resultCode: 2001 }));

      expect(failed.status).toBe('failed');
      expect(failed.lastError).toMatch(/^2001:/);

      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(sellerPayoutKes);
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
      expect(await AuditLog.countDocuments({ action: 'payout_failed' })).toBe(1);
    });

    it('is a no-op on a replayed callback — no double debit', async () => {
      const { seller, payout, sellerPayoutKes } = await processingPayout();
      const result = b2cResult(payout);

      await payoutService.processB2CResult(result);
      // Daraja retries until it gets a 200, so the same body arrives again.
      const replayed = await payoutService.processB2CResult(result);

      expect(replayed.status).toBe('sent');
      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(0);
      expect(await LedgerEntry.countDocuments({ user: seller.user._id, type: 'WITHDRAWAL' })).toBe(1);
      expect(await AuditLog.countDocuments({ action: 'payout_sent' })).toBe(1);
      expect(sellerPayoutKes).toBeGreaterThan(0);
    });

    it('throws when no payout matches the correlation ids', async () => {
      await expect(payoutService.processB2CResult({
        Result: { ResultCode: 0, OriginatorConversationID: 'unknown-1', ConversationID: 'unknown-2' },
      })).rejects.toThrow(/not found/);
    });

    it('rejects a payload with no Result envelope', async () => {
      await expect(payoutService.processB2CResult({})).rejects.toThrow(/Invalid B2C result payload/);
    });
  });

  describe('processB2CTimeout', () => {
    it('fails the payout without touching the wallet', async () => {
      const { seller, payout, sellerPayoutKes } = await processingPayout();

      const timedOut = await payoutService.processB2CTimeout(b2cResult(payout));

      expect(timedOut.status).toBe('failed');
      expect(timedOut.lastError).toMatch(/timed out/);

      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(sellerPayoutKes);
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
    });

    it('ignores a timeout for a payout that already settled', async () => {
      const { seller, payout } = await processingPayout();
      await payoutService.processB2CResult(b2cResult(payout));

      const stillSent = await payoutService.processB2CTimeout(b2cResult(payout));

      expect(stillSent.status).toBe('sent');
      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(0);
    });
  });
});

// ── Step 4: the admin payout queue endpoints ─────────────────────────────────
describe('admin payout endpoints', () => {
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  const listPayouts = (admin, query = '') =>
    request(app)
      .get(`/api/admin/payouts${query}`)
      .set('Authorization', `Bearer ${admin.token}`);

  const approve = (admin, id) =>
    request(app)
      .patch(`/api/admin/payouts/${id}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});

  const reject = (admin, id, body = {}) =>
    request(app)
      .patch(`/api/admin/payouts/${id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send(body);

  const requeue = (admin, id, body = {}) =>
    request(app)
      .patch(`/api/admin/payouts/${id}/requeue`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send(body);

  describe('GET /api/admin/payouts', () => {
    it('refuses a non-admin (403)', async () => {
      const user = await registerUser('seller');

      const res = await request(app)
        .get('/api/admin/payouts')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(403);
    });

    it('refuses an unauthenticated caller (401)', async () => {
      const res = await request(app).get('/api/admin/payouts');
      expect(res.status).toBe(401);
    });

    it('returns the queue newest-first in a { data, meta } envelope', async () => {
      const admin = await asAdmin();
      const older = await PayoutQueue.create(queued({ amountKes: 100 }));
      await sleep(15); // distinct createdAt, otherwise the sort tie-breaks arbitrarily
      const newer = await PayoutQueue.create(queued({ amountKes: 200 }));

      const res = await listPayouts(admin);

      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p._id)).toEqual([newer._id.toString(), older._id.toString()]);
      expect(res.body.meta).toEqual({ total: 2, page: 1, per_page: 50 });
      // The legacy admin endpoints answer `{ logs, pagination }` / `{ disputes, pagination }`;
      // new endpoints use the `{ data, meta }` envelope and nothing else.
      expect(Object.keys(res.body).sort()).toEqual(['data', 'meta']);
    });

    it('filters by status', async () => {
      const admin = await asAdmin();
      await PayoutQueue.create(queued({ amountKes: 100 }));
      await PayoutQueue.create(queued({ amountKes: 200, status: 'sent', transactionReceipt: 'QK1SENT' }));

      const res = await listPayouts(admin, '?status=sent');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].amountKes).toBe(200);
      expect(res.body.meta.total).toBe(1);
    });

    it('rejects an unknown status (400)', async () => {
      const admin = await asAdmin();

      const res = await listPayouts(admin, '?status=definitely_not_a_status');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS');
    });

    it('paginates and clamps per_page', async () => {
      const admin = await asAdmin();
      await PayoutQueue.create(queued());
      await sleep(15);
      await PayoutQueue.create(queued());

      const paged = await listPayouts(admin, '?page=2&per_page=1');
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.meta).toEqual({ total: 2, page: 2, per_page: 1 });

      const clamped = await listPayouts(admin, '?per_page=500');
      expect(clamped.body.meta.per_page).toBe(100);
    });
  });

  describe('PATCH /api/admin/payouts/:id/approve', () => {
    it('refuses a non-admin (403) and leaves the payout untouched', async () => {
      const user = await registerUser('seller');
      const payout = await PayoutQueue.create(queued());

      const res = await request(app)
        .patch(`/api/admin/payouts/${payout._id}/approve`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({});

      expect(res.status).toBe(403);
      expect((await PayoutQueue.findById(payout._id)).status).toBe('pending_approval');
    });

    it('approves a pending payout, records the approver, and audits it', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());

      const res = await approve(admin, payout._id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.approvedBy).toBe(admin.user._id.toString());
      expect(res.body.data.approvedAt).toBeTruthy();

      const audits = await AuditLog.find({ action: 'payout_approved' });
      expect(audits).toHaveLength(1);
      expect(audits[0].user.toString()).toBe(admin.user._id.toString());
      expect(audits[0].metadata.payoutId).toBe(payout._id.toString());
    });

    it('does not call Daraja — dispatch belongs to the worker', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());

      await approve(admin, payout._id);

      // Still `approved` with no attempt and no correlation ids: nothing was sent, so a
      // Daraja outage can never make an approval fail.
      const stored = await PayoutQueue.findById(payout._id);
      expect(stored.status).toBe('approved');
      expect(stored.attempts).toBe(0);
      expect(stored.originatorConversationId).toBeUndefined();
    });

    it('refuses a second approval (409) and audits it once', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());
      expect((await approve(admin, payout._id)).status).toBe(200);

      const res = await approve(admin, payout._id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYOUT_NOT_PENDING');
      expect(await AuditLog.countDocuments({ action: 'payout_approved' })).toBe(1);
    });

    it('refuses to approve while the circuit breaker is tripped (503)', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());
      expect((await toggleBreaker(admin, { action: 'trigger' })).status).toBe(200);

      const res = await approve(admin, payout._id);

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('PAYOUTS_DISABLED');
      // Checked before the CAS, so the payout is still approvable once the breaker clears.
      expect((await PayoutQueue.findById(payout._id)).status).toBe('pending_approval');
      expect(await AuditLog.countDocuments({ action: 'payout_approved' })).toBe(0);

      await toggleBreaker(admin, { action: 'clear' });
      expect((await approve(admin, payout._id)).status).toBe(200);
    });

    it('404s an unknown payout and 400s a malformed id', async () => {
      const admin = await asAdmin();

      expect((await approve(admin, oid())).status).toBe(404);
      expect((await approve(admin, 'not-an-object-id')).status).toBe(400);
    });
  });

  describe('PATCH /api/admin/payouts/:id/reject', () => {
    it('refuses a non-admin (403)', async () => {
      const user = await registerUser('seller');
      const payout = await PayoutQueue.create(queued());

      const res = await request(app)
        .patch(`/api/admin/payouts/${payout._id}/reject`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ reason: 'let me out' });

      expect(res.status).toBe(403);
      expect((await PayoutQueue.findById(payout._id)).status).toBe('pending_approval');
    });

    it('cancels a pending payout and records the reason', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());

      const res = await reject(admin, payout._id, { reason: 'seller under KYC review' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');

      const audits = await AuditLog.find({ action: 'payout_rejected' });
      expect(audits).toHaveLength(1);
      expect(audits[0].user.toString()).toBe(admin.user._id.toString());
      expect(audits[0].metadata.reason).toBe('seller under KYC review');
    });

    it('can still cancel an already-approved payout', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());
      await approve(admin, payout._id);

      const res = await reject(admin, payout._id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect((await AuditLog.findOne({ action: 'payout_rejected' })).metadata.reason).toBeNull();
    });

    it('refuses to cancel a payout already in flight (409)', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued({ status: 'processing' }));

      const res = await reject(admin, payout._id, { reason: 'too late' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYOUT_NOT_REJECTABLE');
      expect((await PayoutQueue.findById(payout._id)).status).toBe('processing');
    });

    it('leaves the seller still owed the money, with the ledger balanced', async () => {
      const admin = await asAdmin();
      const { trade, seller, sellerPayoutKes } = await seedPaidTrade();
      await releaseTrade(trade);
      const payout = await PayoutQueue.findOne({ trade: trade._id });

      expect((await reject(admin, payout._id, { reason: 'wrong M-Pesa number' })).status).toBe(200);

      // Rejecting is not a claw-back: the SELLER_PAYOUT credit stands, `pendingPayout` still
      // holds the money, and no WITHDRAWAL was written.
      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(sellerPayoutKes);
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
      expect((await reconcileWallet(seller.user._id)).delta).toBe(0);
    });
  });

  describe('PATCH /api/admin/payouts/:id/requeue', () => {
    it('refuses a non-admin (403)', async () => {
      const user = await registerUser('seller');
      const payout = await PayoutQueue.create(queued({ status: 'cancelled' }));

      const res = await request(app)
        .patch(`/api/admin/payouts/${payout._id}/requeue`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({});

      expect(res.status).toBe(403);
      expect((await PayoutQueue.findById(payout._id)).status).toBe('cancelled');
    });

    it('takes a rejected payout back to pending_approval and clears the stale approver', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());
      await approve(admin, payout._id);
      await reject(admin, payout._id, { reason: 'wrong M-Pesa number' });

      const res = await requeue(admin, payout._id, { reason: 'seller confirmed new number' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending_approval');
      // A stale approver would misattribute the next approval.
      expect(res.body.data.approvedBy).toBeUndefined();
      expect(res.body.data.approvedAt).toBeUndefined();

      const audits = await AuditLog.find({ action: 'payout_requeued' });
      expect(audits).toHaveLength(1);
      expect(audits[0].user.toString()).toBe(admin.user._id.toString());
      expect(audits[0].metadata.reason).toBe('seller confirmed new number');
    });

    it('completes the round trip — the re-queued payout is approvable again', async () => {
      const admin = await asAdmin();
      const { trade, seller, sellerPayoutKes } = await seedPaidTrade();
      await releaseTrade(trade);
      const payout = await PayoutQueue.findOne({ trade: trade._id });

      await reject(admin, payout._id, { reason: 'typo in phone' });
      expect((await requeue(admin, payout._id)).status).toBe(200);
      const res = await approve(admin, payout._id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.approvedBy).toBe(admin.user._id.toString());

      // `trade` is unique on PayoutQueue, so this is the only route back: one row, reused.
      expect(await PayoutQueue.countDocuments({ trade: trade._id })).toBe(1);
      // No money moved at any point in the round trip.
      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(sellerPayoutKes);
      expect((await reconcileWallet(seller.user._id)).delta).toBe(0);
    });

    it('refuses to re-queue anything but a cancelled payout (409)', async () => {
      const admin = await asAdmin();
      const pending = await PayoutQueue.create(queued());
      // `failed` is deliberately excluded: a timeout may mean Daraja paid and lost the
      // callback, so re-queueing has to be gated on a Transaction Status query.
      const failed = await PayoutQueue.create(queued({ status: 'failed', lastError: 'timed out' }));

      for (const payout of [pending, failed]) {
        const res = await requeue(admin, payout._id);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('PAYOUT_NOT_CANCELLED');
      }

      expect((await PayoutQueue.findById(pending._id)).status).toBe('pending_approval');
      expect((await PayoutQueue.findById(failed._id)).status).toBe('failed');
      expect(await AuditLog.countDocuments({ action: 'payout_requeued' })).toBe(0);
    });

    it('404s an unknown payout', async () => {
      const admin = await asAdmin();
      expect((await requeue(admin, oid())).status).toBe(404);
    });
  });

  describe('error masking in production', () => {
    it('keeps the circuit breaker 503 readable while masking real 500s', async () => {
      const admin = await asAdmin();
      const payout = await PayoutQueue.create(queued());
      await toggleBreaker(admin, { action: 'trigger' });

      // Registration and the breaker toggle happen first: the auth rate limiter only skips
      // itself under NODE_ENV=test, and this flips that out from under it.
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await approve(admin, payout._id);

        expect(res.status).toBe(503);
        // A 503 is never an accident — it is the operator's own message, and the only thing
        // telling the caller to retry later rather than report a bug.
        expect(res.body.error.code).toBe('PAYOUTS_DISABLED');
        expect(res.body.error.message).toMatch(/temporarily disabled/);

        // The generic mask still applies to everything above 503.
        jest.spyOn(PayoutQueue, 'findById').mockImplementationOnce(() => {
          throw new Error('mongo socket closed: 10.0.0.4:27017');
        });
        const boom = await approve(admin, payout._id);

        expect(boom.status).toBe(500);
        expect(boom.body.error.code).toBe('INTERNAL_SERVER_ERROR');
        expect(boom.body.error.message).not.toMatch(/10\.0\.0\.4/);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });
});

// ── Step 5: the B2C callbacks ────────────────────────────────────────────────
describe('B2C webhooks', () => {
  useDarajaEnv();

  const postResult = (body) => request(app).post('/api/mpesa/webhook/b2c-result').send(body);
  const postTimeout = (body) => request(app).post('/api/mpesa/webhook/b2c-timeout').send(body);

  describe('POST /api/mpesa/webhook/b2c-result', () => {
    it('settles the payout and drains pendingPayout', async () => {
      const { seller, trade, payout, sellerPayoutKes } = await processingPayout();

      const res = await postResult(b2cResult(payout, { receipt: 'QKW7HOOK01' }));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'received' });

      const settled = await PayoutQueue.findById(payout._id);
      expect(settled.status).toBe('sent');
      expect(settled.transactionReceipt).toBe('QKW7HOOK01');

      const wallet = await Wallet.findOne({ user: seller.user._id });
      expect(wallet.pendingPayout).toBe(0);
      const withdrawal = await LedgerEntry.findOne({ type: 'WITHDRAWAL' });
      expect(withdrawal.amountKes).toBe(sellerPayoutKes);
      expect((await Trade.findById(trade._id)).payoutRef).toBe('QKW7HOOK01');
      expect((await reconcileWallet(seller.user._id)).delta).toBe(0);
    });

    it('fails the payout on a non-zero ResultCode without touching the wallet', async () => {
      const { seller, payout, sellerPayoutKes } = await processingPayout();

      const res = await postResult(b2cResult(payout, { resultCode: 2001 }));

      expect(res.status).toBe(200);
      expect((await PayoutQueue.findById(payout._id)).status).toBe('failed');
      expect((await Wallet.findOne({ user: seller.user._id })).pendingPayout).toBe(sellerPayoutKes);
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
    });

    it('ACKs a replayed callback without double-debiting', async () => {
      const { seller, payout } = await processingPayout();
      expect((await postResult(b2cResult(payout))).status).toBe(200);

      const replay = await postResult(b2cResult(payout));

      expect(replay.status).toBe(200);
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(1);
      expect((await Wallet.findOne({ user: seller.user._id })).pendingPayout).toBe(0);
    });

    it('ACKs an unmatched or malformed callback with 200 so Daraja stops retrying', async () => {
      const { payout } = await processingPayout();
      const forged = { ...b2cResult(payout) };
      forged.Result.OriginatorConversationID = 'not-a-real-conversation';
      forged.Result.ConversationID = 'not-a-real-conversation';

      const unmatched = await postResult(forged);
      const malformed = await postResult({ nonsense: true });

      for (const res of [unmatched, malformed]) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored' });
      }
      // Nothing was settled by either.
      expect((await PayoutQueue.findById(payout._id)).status).toBe('processing');
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
    });

    it('answers 500 on a transient failure, so Daraja retries', async () => {
      const { payout } = await processingPayout();
      jest.spyOn(payoutService, 'processB2CResult').mockRejectedValueOnce(
        new Error('MongoNetworkError: connection 4 to 10.0.0.4:27017 closed')
      );

      const res = await postResult(b2cResult(payout));

      expect(res.status).toBe(500);
      // 500 is reserved for the cases a retry can still settle — the payout is untouched
      // and still waiting for that retry.
      expect((await PayoutQueue.findById(payout._id)).status).toBe('processing');
    });
  });

  describe('POST /api/mpesa/webhook/b2c-timeout', () => {
    it('fails the payout and leaves the seller owed the money', async () => {
      const { seller, payout, sellerPayoutKes } = await processingPayout();

      const res = await postTimeout(b2cResult(payout));

      expect(res.status).toBe(200);
      const failed = await PayoutQueue.findById(payout._id);
      expect(failed.status).toBe('failed');
      expect(failed.lastError).toMatch(/timed out/);
      expect((await Wallet.findOne({ user: seller.user._id })).pendingPayout).toBe(sellerPayoutKes);
      expect((await reconcileWallet(seller.user._id)).delta).toBe(0);
    });

    it('ACKs a timeout for a payout that already settled', async () => {
      const { payout } = await processingPayout();
      await postResult(b2cResult(payout));

      const res = await postTimeout(b2cResult(payout));

      expect(res.status).toBe(200);
      expect((await PayoutQueue.findById(payout._id)).status).toBe('sent');
      expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(1);
    });

    it('ACKs an unmatched timeout with 200', async () => {
      const orphan = { Result: { OriginatorConversationID: 'nope', ConversationID: 'nope' } };

      const res = await postTimeout(orphan);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ignored' });
    });
  });

  describe('IP allowlist (test-plan item G)', () => {
    it('rejects a non-allowlisted source with 403 and settles nothing', async () => {
      const { payout } = await processingPayout();

      // Enforcement is NODE_ENV-driven and read per request, so production + an allowlist
      // that excludes Jest's loopback source is the whole setup.
      const previous = process.env.NODE_ENV;
      process.env.MPESA_ALLOWED_IPS = '196.201.214.200';
      process.env.NODE_ENV = 'production';
      try {
        const result = await postResult(b2cResult(payout));
        const timeout = await postTimeout(b2cResult(payout));

        for (const res of [result, timeout]) {
          // 403, not 500 — the error middleware would make this look retryable to Daraja.
          expect(res.status).toBe(403);
          expect(res.body.message).toBe('Forbidden source');
        }
        expect((await PayoutQueue.findById(payout._id)).status).toBe('processing');
        expect(await LedgerEntry.countDocuments({ type: 'WITHDRAWAL' })).toBe(0);
      } finally {
        process.env.NODE_ENV = previous;
        delete process.env.MPESA_ALLOWED_IPS;
      }
    });

    it('lets an allowlisted source through', async () => {
      const { payout } = await processingPayout();

      const previous = process.env.NODE_ENV;
      // Jest's supertest calls arrive on loopback; allowlisting it proves the 403 above came
      // from the allowlist decision and not from the route being unreachable.
      process.env.MPESA_ALLOWED_IPS = '127.0.0.1,::1';
      process.env.NODE_ENV = 'production';
      try {
        const res = await postResult(b2cResult(payout));

        expect(res.status).toBe(200);
        expect((await PayoutQueue.findById(payout._id)).status).toBe('sent');
      } finally {
        process.env.NODE_ENV = previous;
        delete process.env.MPESA_ALLOWED_IPS;
      }
    });
  });
});
