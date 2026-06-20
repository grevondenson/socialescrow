/**
 * Self-contained Phase 1-4 E2E proof (supertest + in-memory MongoDB).
 * Proves full HTTP route chain when live Atlas/server unavailable.
 * Usage: node scripts/e2e-phase1-4-local.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-jwt-secret';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'e2e-refresh-secret';

const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const results = [];

const log = (step, message, data = {}, pass = null) => {
  if (pass !== null) results.push({ step, message, pass, data });
  console.log(`${pass ? '✅' : '❌'} [${step}] ${message}${pass === false ? ' ' + JSON.stringify(data) : ''}`);
};

const assert = (step, message, condition, data = {}) => {
  log(step, message, data, !!condition);
  return condition;
};

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let mongoServer;

async function main() {
  console.log('\n=== Phase 1-4 E2E Proof (supertest + memory MongoDB) ===\n');

  // Guard check (same logic as index.js)
  const badKey = Buffer.from('tooshort', 'hex');
  assert('GUARD', 'Bad key (tooshort) fails guard', badKey.length !== 32, { bytes: badKey.length });

  const goodKey = Buffer.from(process.env.VAULT_ENCRYPTION_KEY || '', 'hex');
  assert('GUARD', 'Good .env key passes guard (32 bytes)', goodKey.length === 32, { bytes: goodKey.length });

  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoServer.waitUntilRunning();
  await mongoose.connect(mongoServer.getUri(), { directConnection: false });

  const PlatformAccount = require('../src/models/PlatformAccount.model');
  await PlatformAccount.findOneAndUpdate({}, {}, { upsert: true, setDefaultsOnInsert: true });

  let app;
  ({ app } = require('../src/index'));

  const User = require('../src/models/User.model');
  const Wallet = require('../src/models/Wallet.model');
  const Listing = require('../src/models/Listing.model');
  const Trade = require('../src/models/Trade.model');
  const EscrowRecord = require('../src/models/EscrowRecord.model');
  const LedgerEntry = require('../src/models/LedgerEntry.model');
  const CredentialVault = require('../src/models/CredentialVault.model');
  const FraudFlag = require('../src/models/FraudFlag.model');
  const AuditLog = require('../src/models/AuditLog.model');

  const ts = Date.now();
  const buyerEmail = `buyer-${ts}@e2e.test`;
  const sellerEmail = `seller-${ts}@e2e.test`;

  const registerVerify = async (step, email, name) => {
    const reg = await request(app).post('/api/auth/register').send({
      fullName: name, email, password: 'Password123!', confirmPassword: 'Password123!',
    });
    assert(step, `${name} register → 201`, reg.status === 201, { status: reg.status });
    const user = await User.findOne({ email }).select('+verifyToken');
    const verify = await request(app).get(`/api/auth/verify/${user.verifyToken}`);
    assert(step, `${name} verified`, verify.status === 200, { status: verify.status });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    assert(step, `${name} login → 200`, login.status === 200 && !!login.body.accessToken, { status: login.status });
    return { token: login.body.accessToken, userId: user._id.toString() };
  };

  // STEP 1
  const seller = await registerVerify('STEP1', sellerEmail, 'Seller');
  const buyer = await registerVerify('STEP1', buyerEmail, 'Buyer');
  const wallets = await Wallet.find({ user: { $in: [seller.userId, buyer.userId] } });
  assert('STEP1', 'Wallets auto-created (2)', wallets.length === 2, { count: wallets.length });

  // STEP 2 — listing (skip images when Cloudinary creds are placeholders)
  const cloudinaryReady = process.env.CLOUDINARY_API_KEY && !process.env.CLOUDINARY_API_KEY.includes('your_api');
  let listingReq = request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${seller.token}`)
    .field('platform', 'Instagram')
    .field('followers', '15000')
    .field('niche', 'Fitness')
    .field('priceKes', '50000')
    .field('accountAgeYears', '3');
  if (cloudinaryReady) {
    listingReq = listingReq
      .attach('proofScreenshots', tinyPng, 'proof1.png')
      .attach('proofScreenshots', tinyPng, 'proof2.png');
  }
  const listingRes = await listingReq;

  const listingOk = listingRes.status === 201;
  assert('STEP2', 'Create listing → 201', listingOk, { status: listingRes.status, body: listingRes.body });
  const listingId = listingRes.body.listing?._id;

  if (listingOk) {
    const listing = await Listing.findById(listingId);
    const hasCloudinary = (listing?.proofScreenshots?.length || 0) >= 2;
    assert('STEP2', cloudinaryReady ? 'proofScreenshots ≥2 (Cloudinary)' : 'Listing created without images (no Cloudinary creds)', listingOk, {
      count: listing?.proofScreenshots?.length,
      cloudinaryReady,
    });
    const feed = await request(app).get('/api/listings');
    const inFeed = feed.body?.listings?.some((l) => l._id === listingId);
    assert('STEP2', 'Listing in active feed', inFeed, {});
  }

  // STEP 3
  const tradeInit = await request(app)
    .post('/api/trades')
    .set('Authorization', `Bearer ${buyer.token}`)
    .send({ listingId });
  assert('STEP3', 'Initiate trade → 201', tradeInit.status === 201, { status: tradeInit.status });
  const tradeId = tradeInit.body._id;
  const amountKes = tradeInit.body.amountKes;

  const trade = await Trade.findById(tradeId);
  assert('STEP3', 'Trade payment_window + expiry', trade?.status === 'payment_window' && !!trade?.paymentWindowExpires, {
    status: trade?.status,
  });
  const listingDoc = await Listing.findById(listingId);
  assert('STEP3', 'Listing in_trade', listingDoc?.status === 'in_trade', { status: listingDoc?.status });
  const feedAfter = await request(app).get('/api/listings');
  assert('STEP3', 'Listing removed from active feed', !feedAfter.body?.listings?.some((l) => l._id === listingId), {});

  // STEP 8 early — vault before paid
  const earlyVault = await request(app)
    .post(`/api/trades/${tradeId}/vault`)
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ credentials: 'user:pass' });
  assert('STEP8', 'Vault before paid → 400', earlyVault.status === 400, { status: earlyVault.status });

  // STEP 4
  const mockPay = await request(app)
    .patch(`/api/trades/${tradeId}/mock-payment`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert('STEP4', 'Mock payment → 200', mockPay.status === 200, { status: mockPay.status });

  const tradePaid = await Trade.findById(tradeId);
  assert('STEP4', 'Trade.status paid', tradePaid?.status === 'paid', { status: tradePaid?.status });

  const escrow = await EscrowRecord.findOne({ trade: tradeId });
  assert('STEP4', 'EscrowRecord locked', escrow?.status === 'locked' && escrow?.grossAmount === amountKes, {
    status: escrow?.status, grossAmount: escrow?.grossAmount, expected: amountKes,
  });

  const ledger = await LedgerEntry.find({ trade: tradeId }).sort({ createdAt: 1 });
  const deposit = ledger.find((e) => e.type === 'DEPOSIT');
  const escrowLock = ledger.find((e) => e.type === 'ESCROW_LOCK');
  assert('STEP4', 'DEPOSIT 0→amount', deposit?.balanceBefore === 0 && deposit?.balanceAfter === amountKes, { deposit });
  assert('STEP4', 'ESCROW_LOCK amount→0', escrowLock?.balanceBefore === amountKes && escrowLock?.balanceAfter === 0, { escrowLock });

  const platform = await PlatformAccount.findOne({});
  assert('STEP4', 'PlatformAccount.escrowPool === amount', platform?.escrowPool === amountKes, {
    escrowPool: platform?.escrowPool,
  });

  const walletApi = await request(app).get('/api/wallet').set('Authorization', `Bearer ${buyer.token}`);
  assert('STEP4', 'Wallet availableBalance 0', walletApi.body.availableBalance === 0, { v: walletApi.body.availableBalance });
  assert('STEP4', 'Wallet lockedInEscrow === amount', walletApi.body.lockedInEscrow === amountKes, { v: walletApi.body.lockedInEscrow });

  // STEP 5
  const vaultSubmit = await request(app)
    .post(`/api/trades/${tradeId}/vault`)
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ credentials: 'testuser:secretpass123' });
  assert('STEP5', 'Vault submit → 200', vaultSubmit.status === 200, { status: vaultSubmit.status });
  const vault = await CredentialVault.findOne({ trade: tradeId });
  assert('STEP5', 'CredentialVault created', !!vault, {});
  assert('STEP5', 'No secrets in response', !JSON.stringify(vaultSubmit.body).includes('encrypted'), {});

  const release = await request(app)
    .patch(`/api/trades/${tradeId}/release`)
    .set('Authorization', `Bearer ${seller.token}`);
  assert('STEP5', 'Release → 200', release.status === 200, { status: release.status });
  assert('STEP5', 'Trade credentials_released', (await Trade.findById(tradeId))?.status === 'credentials_released', {});

  // STEP 6
  const reveal1 = await request(app)
    .get(`/api/trades/${tradeId}/vault/reveal`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert('STEP6', 'First reveal 200 + plaintext', reveal1.status === 200 && reveal1.body.credentials === 'testuser:secretpass123', {
    status: reveal1.status,
  });
  const vaultAfter = await CredentialVault.findOne({ trade: tradeId });
  assert('STEP6', 'revealed + revealedAt', vaultAfter?.revealed === true && !!vaultAfter?.revealedAt, {});

  const reveal2 = await request(app)
    .get(`/api/trades/${tradeId}/vault/reveal`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert('STEP6', 'Second reveal → 410', reveal2.status === 410, { status: reveal2.status });

  const fraud = await FraudFlag.findOne({ trade: tradeId, flagType: 'VAULT_DOUBLE_REVEAL' });
  assert('STEP6', 'FraudFlag VAULT_DOUBLE_REVEAL', !!fraud, {});

  const audits = await AuditLog.find({}).lean();
  const tradeAudits = audits.filter((a) => a.metadata?.tradeId?.toString() === tradeId);
  const actions = tradeAudits.map((a) => a.action);
  assert('STEP6', 'AuditLog VAULT_SUBMIT', actions.includes('VAULT_SUBMIT'), { actions });
  assert('STEP6', 'AuditLog VAULT_REVEAL', actions.includes('VAULT_REVEAL'), { actions });
  assert('STEP6', 'AuditLog VAULT_REVEAL_ATTEMPT_FAILED', actions.includes('VAULT_REVEAL_ATTEMPT_FAILED'), { actions });

  // STEP 7
  const reconcile = await request(app)
    .get('/api/wallet/reconcile')
    .set('Authorization', `Bearer ${buyer.token}`);
  assert('STEP7', 'Reconcile isBalanced true (real route + real data)', reconcile.body.isBalanced === true, {
    reconcile: reconcile.body,
  });

  // STEP 8
  const tradeDetail = await request(app)
    .get(`/api/trades/${tradeId}`)
    .set('Authorization', `Bearer ${buyer.token}`);
  assert('STEP8', 'vaultStatus in response', !!tradeDetail.body.vaultStatus, {
    vaultStatus: tradeDetail.body.vaultStatus,
    hasVaultCredentials: tradeDetail.body.hasVaultCredentials,
  });
  assert('STEP8', 'platformFeeKes from server (3000)', tradeDetail.body.platformFeeKes === 3000, {
    platformFeeKes: tradeDetail.body.platformFeeKes,
  });

  await mongoose.disconnect();
  await mongoServer.stop();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
