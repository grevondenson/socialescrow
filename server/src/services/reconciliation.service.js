const Wallet = require('../models/Wallet.model');
const LedgerEntry = require('../models/LedgerEntry.model');
const EscrowRecord = require('../models/EscrowRecord.model');
const PlatformAccount = require('../models/PlatformAccount.model');
const FraudFlag = require('../models/FraudFlag.model');

/**
 * Entry types that increase the user's net holdings.
 * DEPOSIT is the only type that brings new money in.
 */
const CREDIT_TYPES = ['DEPOSIT'];

/**
 * Entry types that decrease the user's net holdings.
 */
const DEBIT_TYPES = ['SELLER_PAYOUT', 'PLATFORM_FEE'];

/**
 * Reconcile a user's wallet against their ledger history.
 * Expected total = sum(credits) - sum(debits)
 * Actual total   = availableBalance + lockedInEscrow + pendingPayout
 *
 * @param {string} userId
 * @returns {{ isBalanced: boolean, expected: number, actual: number, delta: number }}
 */
const reconcileWallet = async (userId) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) throw new Error(`Wallet not found for user ${userId}`);

  // Aggregate credit totals
  const creditAgg = await LedgerEntry.aggregate([
    { $match: { user: wallet._id, type: { $in: CREDIT_TYPES } } },
    { $group: { _id: null, total: { $sum: '$amountKes' } } }
  ]);

  // Aggregate debit totals
  const debitAgg = await LedgerEntry.aggregate([
    { $match: { user: wallet._id, type: { $in: DEBIT_TYPES } } },
    { $group: { _id: null, total: { $sum: '$amountKes' } } }
  ]);

  const creditSum = creditAgg[0]?.total ?? 0;
  const debitSum  = debitAgg[0]?.total  ?? 0;
  const expected  = creditSum - debitSum;
  const actual    = wallet.availableBalance + wallet.lockedInEscrow + wallet.pendingPayout;
  const delta     = expected - actual;
  const isBalanced = delta === 0;

  // Update lastReconciledAt
  await Wallet.findByIdAndUpdate(wallet._id, { lastReconciledAt: new Date() });

  if (!isBalanced) {
    // Create fraud flag for admin review
    await FraudFlag.create({
      user:      userId,
      flagType:  'RECONCILIATION_MISMATCH',
      riskScore: Math.min(100, Math.abs(delta) > 1000 ? 80 : 50),
      riskLevel: Math.abs(delta) > 1000 ? 'high' : 'medium',
      note:      `Reconciliation mismatch: expected ${expected}, actual ${actual}, delta ${delta}`,
    });
  }

  return { isBalanced, expected, actual, delta };
};

/**
 * Reconcile the platform account's escrow pool against locked EscrowRecords.
 *
 * @returns {{ isBalanced: boolean, expected: number, actual: number, delta: number }}
 */
const reconcilePlatformAccount = async () => {
  const platformAccount = await PlatformAccount.findOne({});
  if (!platformAccount) throw new Error('PlatformAccount not found');

  // Sum all locked escrow records
  const agg = await EscrowRecord.aggregate([
    { $match: { status: 'locked' } },
    { $group: { _id: null, total: { $sum: '$grossAmount' } } }
  ]);

  const expected  = agg[0]?.total ?? 0;
  const actual    = platformAccount.escrowPool;
  const delta     = expected - actual;
  const isBalanced = delta === 0;

  await PlatformAccount.findOneAndUpdate({}, { lastReconciledAt: new Date() });

  return { isBalanced, expected, actual, delta };
};

module.exports = { reconcileWallet, reconcilePlatformAccount };
