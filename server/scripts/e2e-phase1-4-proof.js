/**
 * Consolidated Phase 1-4 E2E proof runner.
 * Usage: node scripts/e2e-phase1-4-proof.js
 * Requires: server running on PORT (default 5000), .env with valid keys + MONGODB_URI
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const BASE = process.env.E2E_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const results = [];

const log = (step, message, data = {}, pass = null) => {
  if (pass !== null) results.push({ step, message, pass, data });
  console.log(`${pass === true ? '✅' : pass === false ? '❌' : 'ℹ️'} [${step}] ${message}`, pass === null ? '' : pass ? '' : JSON.stringify(data));
};

const assert = (step, message, condition, data = {}) => {
  log(step, message, data, !!condition);
  return condition;
};

const api = async (method, path, { token, body, json } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : body,
  });
  let data;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};

const registerAndVerify = async (step, label, email) => {
  const reg = await api('POST', '/api/auth/register', {
    json: { fullName: label, email, password: 'Password123!', confirmPassword: 'Password123!' },
  });
  if (!assert(step, `${label} register → 201`, reg.status === 201, { status: reg.status })) return null;

  const User = require('../src/models/User.model');
  const user = await User.findOne({ email }).select('+verifyToken');
  const verify = await api('GET', `/api/auth/verify/${user.verifyToken}`);
  assert(step, `${label} email verified`, verify.status === 200, { status: verify.status });

  const login = await api('POST', '/api/auth/login', {
    json: { email, password: 'Password123!' },
  });
  assert(step, `${label} login → 200 + token`, login.status === 200 && !!login.data.accessToken, { status: login.status });
  return { token: login.data.accessToken, userId: user._id.toString(), email };
};

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function run() {
  console.log(`\n=== Phase 1-4 E2E Proof ===\nBase URL: ${BASE}\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  log('SETUP', 'MongoDB connected for direct verification');

  const ts = Date.now();
  const buyerEmail = `buyer-${ts}@e2e.test`;
  const sellerEmail = `seller-${ts}@e2e.test`;

  // STEP 1
  const seller = await registerAndVerify('STEP1', 'Seller', sellerEmail);
  const buyer = await registerAndVerify('STEP1', 'Buyer', buyerEmail);
  if (!seller || !buyer) { await mongoose.disconnect(); process.exit(1); }

  const Wallet = require('../src/models/Wallet.model');
  const wallets = await Wallet.find({ user: { $in: [seller.userId, buyer.userId] } });
  assert('STEP1', 'Wallets auto-created for both users', wallets.length === 2, { count: wallets.length });

  // STEP 2 — listing with images (optional if Cloudinary configured)
  const form = new FormData();
  form.append('platform', 'Instagram');
  form.append('followers', '15000');
  form.append('niche', 'Fitness');
  form.append('priceKes', '50000');
  form.append('accountAgeYears', '3');
  form.append('description', 'E2E proof listing');
  form.append('proofScreenshots', new Blob([tinyPng], { type: 'image/png' }), 'proof1.png');
  form.append('proofScreenshots', new Blob([tinyPng], { type: 'image/png' }), 'proof2.png');

  const listingRes = await fetch(`${BASE}/api/listings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${seller.token}` },
    body: form,
  });
  const listingData = await listingRes.json();
  const listingOk = listingRes.status === 201;
  assert('STEP2', 'Seller creates listing → 201', listingOk, { status: listingRes.status, message: listingData.message });

  const listingId = listingData.listing?._id;
  if (listingOk && listingId) {
    const Listing = require('../src/models/Listing.model');
    const listing = await Listing.findById(listingId);
    const hasScreenshots = listing?.proofScreenshots?.length >= 2;
    assert('STEP2', 'proofScreenshots has Cloudinary URLs (≥2)', hasScreenshots, {
      count: listing?.proofScreenshots?.length,
      urls: listing?.proofScreenshots,
    });

    const feed = await api('GET', '/api/listings');
    const inFeed = feed.data?.listings?.some((l) => l._id === listingId);
    assert('STEP2', 'Listing appears in GET /listings (active)', inFeed, { status: feed.status });
  }

  // STEP 3
  const tradeInit = await api('POST', '/api/trades', {
    token: buyer.token,
    json: { listingId },
  });
  assert('STEP3', 'Buyer initiates trade → 201', tradeInit.status === 201, { status: tradeInit.status });
  const tradeId = tradeInit.data?._id;

  if (tradeId) {
    const Trade = require('../src/models/Trade.model');
    const Listing = require('../src/models/Listing.model');
    const trade = await Trade.findById(tradeId);
    assert('STEP3', 'Trade.status === payment_window', trade?.status === 'payment_window', { status: trade?.status });
    assert('STEP3', 'paymentWindowExpires set', !!trade?.paymentWindowExpires, {});

    const listing = await Listing.findById(listingId);
    assert('STEP3', 'Listing.status === in_trade', listing?.status === 'in_trade', { status: listing?.status });

    const feed = await api('GET', '/api/listings');
    const notInFeed = !feed.data?.listings?.some((l) => l._id === listingId);
    assert('STEP3', 'Listing no longer in active marketplace feed', notInFeed, {});
  }

  // STEP 8 carry-forward (early): vault submit before payment rejected
  const earlyVault = await api('POST', `/api/trades/${tradeId}/vault`, {
    token: seller.token,
    json: { credentials: 'user:pass' },
  });
  assert('STEP8', 'Vault submit before paid → rejected', earlyVault.status === 400, { status: earlyVault.status });

  // STEP 4 — mock payment
  const mockPay = await api('PATCH', `/api/trades/${tradeId}/mock-payment`, { token: buyer.token });
  assert('STEP4', 'Mock payment → 200', mockPay.status === 200, { status: mockPay.status });

  const amountKes = tradeInit.data?.amountKes || 50000;
  const Trade = require('../src/models/Trade.model');
  const EscrowRecord = require('../src/models/EscrowRecord.model');
  const LedgerEntry = require('../src/models/LedgerEntry.model');
  const PlatformAccount = require('../src/models/PlatformAccount.model');

  const tradeAfterPay = await Trade.findById(tradeId);
  assert('STEP4', 'Trade.status → paid', tradeAfterPay?.status === 'paid', { status: tradeAfterPay?.status });

  const escrow = await EscrowRecord.findOne({ trade: tradeId });
  assert('STEP4', 'EscrowRecord created, status locked', escrow?.status === 'locked', {
    status: escrow?.status,
    grossAmount: escrow?.grossAmount,
  });
  assert('STEP4', 'EscrowRecord.grossAmount === trade.amountKes', escrow?.grossAmount === amountKes, {
    expected: amountKes,
    actual: escrow?.grossAmount,
  });

  const ledger = await LedgerEntry.find({ trade: tradeId }).sort({ createdAt: 1 });
  const deposit = ledger.find((e) => e.type === 'DEPOSIT');
  const escrowLock = ledger.find((e) => e.type === 'ESCROW_LOCK');
  assert('STEP4', 'LedgerEntry DEPOSIT (0→amount)', deposit?.balanceBefore === 0 && deposit?.balanceAfter === amountKes, {
    deposit,
  });
  assert('STEP4', 'LedgerEntry ESCROW_LOCK (amount→0)', escrowLock?.balanceBefore === amountKes && escrowLock?.balanceAfter === 0, {
    escrowLock,
  });

  const platform = await PlatformAccount.findOne({});
  assert('STEP4', 'PlatformAccount.escrowPool === amountKes', platform?.escrowPool === amountKes, {
    escrowPool: platform?.escrowPool,
    expected: amountKes,
  });

  const walletApi = await api('GET', '/api/wallet', { token: buyer.token });
  assert('STEP4', 'GET /wallet availableBalance: 0', walletApi.data?.availableBalance === 0, {
    availableBalance: walletApi.data?.availableBalance,
  });
  assert('STEP4', 'GET /wallet lockedInEscrow === amount', walletApi.data?.lockedInEscrow === amountKes, {
    lockedInEscrow: walletApi.data?.lockedInEscrow,
  });

  // STEP 5
  const vaultSubmit = await api('POST', `/api/trades/${tradeId}/vault`, {
    token: seller.token,
    json: { credentials: 'testuser:secretpass123' },
  });
  assert('STEP5', 'Vault submit → 200', vaultSubmit.status === 200, { status: vaultSubmit.status });

  const CredentialVault = require('../src/models/CredentialVault.model');
  const vault = await CredentialVault.findOne({ trade: tradeId });
  assert('STEP5', 'CredentialVault created', !!vault, {});
  const vaultLeak = JSON.stringify(vaultSubmit.data);
  assert('STEP5', 'No encryptedCredentials/iv in API response', !vaultLeak.includes('encryptedCredentials') && !vaultLeak.includes('iv'), {});

  const release = await api('PATCH', `/api/trades/${tradeId}/release`, { token: seller.token });
  assert('STEP5', 'Release credentials → 200', release.status === 200, { status: release.status });
  const tradeReleased = await Trade.findById(tradeId);
  assert('STEP5', 'Trade.status → credentials_released', tradeReleased?.status === 'credentials_released', {
    status: tradeReleased?.status,
  });

  // STEP 6
  const reveal1 = await api('GET', `/api/trades/${tradeId}/vault/reveal`, { token: buyer.token });
  assert('STEP6', 'First reveal → 200 + plaintext', reveal1.status === 200 && reveal1.data?.credentials === 'testuser:secretpass123', {
    status: reveal1.status,
    hasCredentials: !!reveal1.data?.credentials,
  });

  const vaultAfter = await CredentialVault.findOne({ trade: tradeId });
  assert('STEP6', 'CredentialVault.revealed === true', vaultAfter?.revealed === true, { revealed: vaultAfter?.revealed });
  assert('STEP6', 'CredentialVault.revealedAt set', !!vaultAfter?.revealedAt, {});

  const reveal2 = await api('GET', `/api/trades/${tradeId}/vault/reveal`, { token: buyer.token });
  assert('STEP6', 'Second reveal → 410 Gone', reveal2.status === 410, { status: reveal2.status });

  const FraudFlag = require('../src/models/FraudFlag.model');
  const fraud = await FraudFlag.findOne({ trade: tradeId, flagType: 'VAULT_DOUBLE_REVEAL' });
  assert('STEP6', 'FraudFlag VAULT_DOUBLE_REVEAL created', !!fraud, { flagType: fraud?.flagType });

  const AuditLog = require('../src/models/AuditLog.model');
  const audits = await AuditLog.find({ 'metadata.tradeId': tradeId }).lean();
  const actions = audits.map((a) => a.action);
  assert('STEP6', 'AuditLog VAULT_SUBMIT', actions.includes('VAULT_SUBMIT'), { actions });
  assert('STEP6', 'AuditLog VAULT_REVEAL', actions.includes('VAULT_REVEAL'), { actions });
  assert('STEP6', 'AuditLog VAULT_REVEAL_ATTEMPT_FAILED', actions.includes('VAULT_REVEAL_ATTEMPT_FAILED'), { actions });

  // STEP 7
  const reconcile = await api('GET', '/api/wallet/reconcile', { token: buyer.token });
  assert('STEP7', 'GET /wallet/reconcile isBalanced: true', reconcile.data?.isBalanced === true, {
    reconcile: reconcile.data,
  });

  // STEP 8 — trade metadata + fee from server
  const tradeDetail = await api('GET', `/api/trades/${tradeId}`, { token: buyer.token });
  assert('STEP8', 'GET /trades/:id includes vaultStatus', !!tradeDetail.data?.vaultStatus, {
    vaultStatus: tradeDetail.data?.vaultStatus,
    hasVaultCredentials: tradeDetail.data?.hasVaultCredentials,
  });
  assert('STEP8', 'platformFeeKes from server (3000 for 50000)', tradeDetail.data?.platformFeeKes === 3000, {
    platformFeeKes: tradeDetail.data?.platformFeeKes,
  });

  await mongoose.disconnect();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('E2E fatal:', err);
  process.exit(1);
});
