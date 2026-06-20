const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

const { connectTestDB, disconnectTestDB, clearCollections } = require('./setup');
const { reconcileWallet } = require('../src/services/reconciliation.service');
const Wallet = require('../src/models/Wallet.model');
const LedgerEntry = require('../src/models/LedgerEntry.model');

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
afterEach(clearCollections);

describe('reconcileWallet', () => {
  it('returns isBalanced true when ledger credits match wallet totals', async () => {
    const userId = new mongoose.Types.ObjectId();

    await Wallet.create({
      user: userId,
      availableBalance: 5000,
      lockedInEscrow: 2000,
      pendingPayout: 0,
    });

    await LedgerEntry.create({
      user: userId,
      type: 'DEPOSIT',
      amountKes: 7000,
      balanceBefore: 0,
      balanceAfter: 7000,
    });

    const result = await reconcileWallet(userId.toString());

    expect(result.isBalanced).toBe(true);
    expect(result.expected).toBe(7000);
    expect(result.actual).toBe(7000);
    expect(result.delta).toBe(0);
  });

  it('flags mismatch when aggregation uses wrong user id', async () => {
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({
      user: userId,
      availableBalance: 1000,
      lockedInEscrow: 0,
      pendingPayout: 0,
    });

    // Ledger keyed to user id — matching wallet.user, not wallet._id
    await LedgerEntry.create({
      user: userId,
      type: 'DEPOSIT',
      amountKes: 1000,
      balanceBefore: 0,
      balanceAfter: 1000,
    });

    const result = await reconcileWallet(userId.toString());

    expect(result.isBalanced).toBe(true);
    expect(wallet.user.toString()).not.toBe(wallet._id.toString());
  });
});
