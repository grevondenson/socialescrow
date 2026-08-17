const Wallet = require('../models/Wallet.model');
const LedgerEntry = require('../models/LedgerEntry.model');
const EscrowRecord = require('../models/EscrowRecord.model');
const PlatformAccount = require('../models/PlatformAccount.model');
const FraudFlag = require('../models/FraudFlag.model');

/**
 * Ledger entry types are classified by their effect on a user's NET holdings, where
 * net holdings = availableBalance + lockedInEscrow + pendingPayout.
 *
 * Anything that only shuffles money between those three buckets is NEUTRAL and must be
 * excluded from both lists, or it would be counted twice.
 *
 *   NEUTRAL  ESCROW_LOCK   availableBalance → lockedInEscrow (lockFunds)
 *            REFUND        lockedInEscrow → availableBalance (unlockFunds)
 *            DISPUTE_HOLD  informational only; freeze() moves no balance
 *            PLATFORM_FEE  informational only. Written with `user: trade.seller` by
 *                          convention, but the fee revenue lands in
 *                          PlatformAccount.revenueBalance — never in a user wallet.
 *                          sellerPayoutKes is already net of the fee, so counting it
 *                          as a seller debit would subtract it a second time.
 */

/** Types that bring new money into the user's net holdings. */
const CREDIT_TYPES = [
  'DEPOSIT',        // new money in from M-Pesa
  'SELLER_PAYOUT',  // escrow released to the seller: pendingPayout increases
];

/** Types that take money out of the user's net holdings. */
const DEBIT_TYPES = [
  'ESCROW_RELEASE', // buyer's locked deposit leaves for the seller (gross on release, seller's share on split)
  'WITHDRAWAL',     // B2C disbursement: pendingPayout drains and the money leaves the platform
];

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
    { $match: { user: wallet.user, type: { $in: CREDIT_TYPES } } },
    { $group: { _id: null, total: { $sum: '$amountKes' } } }
  ]);

  // Aggregate debit totals
  const debitAgg = await LedgerEntry.aggregate([
    { $match: { user: wallet.user, type: { $in: DEBIT_TYPES } } },
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
 * Trigger a platform-wide circuit breaker when an integrity condition is detected.
 * @param {string} reason
 */
const triggerPlatformCircuitBreaker = async (reason) => {
  await PlatformAccount.findOneAndUpdate(
    {},
    {
      payoutsEnabled: false,
      circuitBreakerTriggeredAt: new Date(),
      circuitBreakerReason: reason,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

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

  if (!isBalanced) {
    await triggerPlatformCircuitBreaker(`Escrow pool mismatch: expected ${expected}, actual ${actual}, delta ${delta}`);
  }

  await PlatformAccount.findOneAndUpdate(
    {},
    { lastReconciledAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { isBalanced, expected, actual, delta };
};

module.exports = { reconcileWallet, reconcilePlatformAccount };
