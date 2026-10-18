/**
 * Regression tests for admin audit fixes found by the documentation-vs-code audit.
 *
 * Three defects motivated this file:
 *  1. GET /api/admin/fraud-flags 500'd because admin.controller.js used FraudFlag without importing it.
 *  2. Every admin AuditLog write used the field `userId`, but the model defines `user` — under Mongoose
 *     strict mode the actor was silently dropped from every audit record.
 *  3. Several writers used action names absent from the AuditLog enum ('kyc_review',
 *     'listing_moderation', 'kyc_name_mismatch') and the ban reused 'register', so those audit writes
 *     were rejected and the records lost.
 *
 * A replica set is required because some admin paths run in transactions.
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
const AuditLog = require('../src/models/AuditLog.model');
const FraudFlag = require('../src/models/FraudFlag.model');

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

const makeAdmin = async () => {
  const admin = await registerUser('admin');
  await User.findByIdAndUpdate(admin.user._id, { role: 'admin' });
  return admin;
};

const asAdmin = (req, token) => req.set('Authorization', `Bearer ${token}`);

// ── Fraud flags ─────────────────────────────────────────────────────────────

describe('GET /api/admin/fraud-flags', () => {
  it('lists flags (route no longer 500s from the missing FraudFlag import)', async () => {
    const admin = await makeAdmin();
    const flagged = await registerUser('flagged');
    await FraudFlag.create({
      user: flagged.user._id,
      flagType: 'VAULT_DOUBLE_REVEAL',
      riskScore: 80,
      riskLevel: 'high',
      note: 'double reveal',
    });

    const res = await asAdmin(request(app).get('/api/admin/fraud-flags'), admin.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    // user must be populated, which only works once the model is actually imported.
    expect(res.body.data[0].user.fullName).toBe(flagged.user.fullName);
    expect(res.body.data[0].flagType).toBe('VAULT_DOUBLE_REVEAL');
  });

  it('filters by riskLevel and rejects an invalid level', async () => {
    const admin = await makeAdmin();
    const u1 = await registerUser('hi');
    const u2 = await registerUser('lo');
    await FraudFlag.create({ user: u1.user._id, flagType: 'IP_MISMATCH', riskScore: 80, riskLevel: 'high' });
    await FraudFlag.create({ user: u2.user._id, flagType: 'IP_MISMATCH', riskScore: 10, riskLevel: 'low' });

    const high = await asAdmin(request(app).get('/api/admin/fraud-flags?riskLevel=high'), admin.token);
    expect(high.status).toBe(200);
    expect(high.body.data).toHaveLength(1);
    expect(high.body.data[0].riskLevel).toBe('high');

    const bad = await asAdmin(request(app).get('/api/admin/fraud-flags?riskLevel=bogus'), admin.token);
    expect(bad.status).toBe(400);
  });

  it('is forbidden to non-admin users', async () => {
    const plain = await registerUser('plain');
    const res = await asAdmin(request(app).get('/api/admin/fraud-flags'), plain.token);
    expect(res.status).toBe(403);
  });
});

// ── Audit actor + enum persistence ──────────────────────────────────────────

describe('admin audit writes', () => {
  it('records the acting admin under `userId`', async () => {
    const admin = await makeAdmin();
    const target = await registerUser('target');

    const ban = await asAdmin(
      request(app).patch(`/api/admin/users/${target.user._id}/ban`).send({ banReason: 'test' }),
      admin.token
    );
    expect(ban.status).toBe(200);

    const log = await AuditLog.findOne({ action: 'user_ban' });
    expect(log).toBeTruthy();

    // `userId` is the schema path, so this is the only actor field that survives strict mode.
    expect(log.userId).toBeTruthy();
    expect(String(log.userId)).toBe(String(admin.user._id));
    // The old `user` spelling must not be stored alongside it.
    expect(log.toObject().user).toBeUndefined();

    // And the read endpoint populates it; a mismatch here throws StrictPopulateError (500).
    const feed = await asAdmin(request(app).get('/api/admin/audit-log'), admin.token);
    expect(feed.status).toBe(200);
    const entry = feed.body.logs.find((l) => l.action === 'user_ban');
    expect(entry).toBeTruthy();
    expect(entry.userId.fullName).toBe(admin.user.fullName);
  });

  it('persists kyc_review instead of failing the enum', async () => {
    const admin = await makeAdmin();
    const target = await registerUser('kyc');

    const review = await asAdmin(
      request(app)
        .patch(`/api/admin/users/${target.user._id}/kyc-review`)
        .send({ decision: 'approve' }),
      admin.token
    );
    expect(review.status).toBe(200);

    const log = await AuditLog.findOne({ action: 'kyc_review' });
    expect(log).toBeTruthy();
    expect(String(log.userId)).toBe(String(admin.user._id));
  });
});
