const mongoose = require('mongoose');
const Wallet = require('../models/Wallet.model');
const LedgerEntry = require('../models/LedgerEntry.model');
const PlatformAccount = require('../models/PlatformAccount.model');

/**
 * Custom error for operations that fail due to insufficient funds.
 * This error is specifically caught to return a 400 Bad Request status to the client.
 * @extends Error
 *
 * @property {string} name - The name of the error, 'InsufficientFundsError'.
 * @property {number} statusCode - The HTTP status code to be returned, 400.
 */
class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient funds') {
    super(message);
    this.name = 'InsufficientFundsError';
    this.statusCode = 400;
  }
}

/**
 * A helper function to manage MongoDB sessions.
 * If a session is provided by the caller, it uses it (controller-owned transaction).
 * If no session is provided, it creates, manages, and closes its own session.
 * This ensures all operations within the callback `fn` are atomic.
 * @param {mongoose.ClientSession | null} session - An existing Mongoose session.
 * @param {(session: mongoose.ClientSession) => Promise<any>} fn - The async function to execute within the transaction.
 * @returns {Promise<any>} The result of the `fn` function.
 */
const _runInSession = async (session, fn) => {
  const ownSession = !session;
  if (ownSession) {
    session = await mongoose.startSession();
    session.startTransaction();
  }
  try {
    const result = await fn(session);
    if (ownSession) await session.commitTransaction();
    return result;
  } catch (err) {
    if (ownSession) await session.abortTransaction();
    throw err;
  } finally {
    if (ownSession) session.endSession();
  }
};

/**
 * Atomically credits a user's available balance and creates a corresponding ledger entry.
 *
 * @param {string | mongoose.Types.ObjectId} userId - The ID of the user to credit.
 * @param {number} amountKes - The amount to credit (in KES). Must be a positive integer.
 * @param {string} type - The type of ledger entry (e.g., 'DEPOSIT', 'REFUND').
 * @param {object} [meta={}] - Optional metadata for the ledger entry.
 * @param {string | mongoose.Types.ObjectId} [meta.tradeId] - The associated trade ID.
 * @param {string} [meta.note] - A descriptive note.
 * @param {string} [meta.reference] - An external reference code.
 * @param {mongoose.ClientSession | null} [session=null] - An optional Mongoose session for transactions.
 * @returns {Promise<import('../models/Wallet.model')>} The updated wallet object.
 * @throws {Error} If the wallet for the user is not found.
 */
const credit = async (userId, amountKes, type, meta = {}, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

    // Returns doc BEFORE update (new: false)
    const oldWallet = await Wallet.findOneAndUpdate(
      { user: userId },
      { $inc: { availableBalance: amountKes } },
      { new: false, ...opts }
    );

    if (!oldWallet) throw new Error(`Wallet not found for user ${userId}`);

    const balanceBefore = oldWallet.availableBalance;
    const balanceAfter  = balanceBefore + amountKes;

    await LedgerEntry.create(
      [{
        trade:     meta.tradeId   || undefined,
        user:      userId,
        type,
        amountKes,
        balanceBefore,
        balanceAfter,
        reference: meta.reference || undefined,
        note:      meta.note      || undefined,
      }],
      opts
    );

    return { ...oldWallet.toObject(), availableBalance: balanceAfter };
  });
};

/**
 * Atomically debits a user's available balance and creates a corresponding ledger entry.
 * This operation is protected against overdrafts by a `$gte` guard in the query.
 *
 * @param {string | mongoose.Types.ObjectId} userId - The ID of the user to debit.
 * @param {number} amountKes - The amount to debit (in KES). Must be a positive integer.
 * @param {string} type - The type of ledger entry (e.g., 'WITHDRAWAL', 'ESCROW_LOCK').
 * @param {object} [meta={}] - Optional metadata for the ledger entry.
 * @param {string | mongoose.Types.ObjectId} [meta.tradeId] - The associated trade ID.
 * @param {string} [meta.note] - A descriptive note.
 * @param {string} [meta.reference] - An external reference code.
 * @param {mongoose.ClientSession | null} [session=null] - An optional Mongoose session for transactions.
 * @returns {Promise<import('../models/Wallet.model')>} The updated wallet object.
 * @throws {InsufficientFundsError} If the user's available balance is less than the amount to be debited.
 */
const debit = async (userId, amountKes, type, meta = {}, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

    const oldWallet = await Wallet.findOneAndUpdate(
      { user: userId, availableBalance: { $gte: amountKes } },
      { $inc: { availableBalance: -amountKes } },
      { new: false, ...opts }
    );

    if (!oldWallet) throw new InsufficientFundsError();

    const balanceBefore = oldWallet.availableBalance;
    const balanceAfter  = balanceBefore - amountKes;

    await LedgerEntry.create(
      [{
        trade:     meta.tradeId   || undefined,
        user:      userId,
        type,
        amountKes,
        balanceBefore,
        balanceAfter,
        reference: meta.reference || undefined,
        note:      meta.note      || undefined,
      }],
      opts
    );

    return { ...oldWallet.toObject(), availableBalance: balanceAfter };
  });
};

/**
 * Atomically moves funds from a user's available balance to their locked-in-escrow balance.
 * This is a single, atomic operation to prevent race conditions.
 *
 * @param {string | mongoose.Types.ObjectId} userId - The ID of the user whose funds are being locked.
 * @param {number} amountKes - The amount to lock into escrow.
 * @param {string | mongoose.Types.ObjectId} tradeId - The ID of the trade these funds are for.
 * @param {mongoose.ClientSession | null} [session=null] - An optional Mongoose session for transactions.
 * @returns {Promise<import('../models/Wallet.model')>} The updated wallet object.
 * @throws {InsufficientFundsError} If the available balance is insufficient.
 */
const lockFunds = async (userId, amountKes, tradeId, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

    const oldWallet = await Wallet.findOneAndUpdate(
      { user: userId, availableBalance: { $gte: amountKes } },
      { $inc: { availableBalance: -amountKes, lockedInEscrow: amountKes } },
      { new: false, ...opts }
    );

    if (!oldWallet) throw new InsufficientFundsError('Insufficient available balance to lock into escrow');

    const balanceBefore = oldWallet.availableBalance;
    const balanceAfter  = balanceBefore - amountKes;

    await LedgerEntry.create(
      [{
        trade:         tradeId,
        user:          userId,
        type:          'ESCROW_LOCK',
        amountKes,
        balanceBefore,
        balanceAfter,
      }],
      opts
    );

    return {
      ...oldWallet.toObject(),
      availableBalance: balanceAfter,
      lockedInEscrow: oldWallet.lockedInEscrow + amountKes,
    };
  });
};

/**
 * Atomically moves funds from a user's locked-in-escrow balance back to their available balance.
 * This is used for refunds or when a trade is cancelled after funds are locked.
 *
 * @param {string | mongoose.Types.ObjectId} userId - The ID of the user whose funds are being unlocked.
 * @param {number} amountKes - The amount to unlock from escrow.
 * @param {string | mongoose.Types.ObjectId} tradeId - The ID of the trade associated with the refund.
 * @param {mongoose.ClientSession | null} [session=null] - An optional Mongoose session for transactions.
 * @returns {Promise<import('../models/Wallet.model')>} The updated wallet object.
 * @throws {Error} If the wallet for the user is not found.
 */
const unlockFunds = async (userId, amountKes, tradeId, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

    const oldWallet = await Wallet.findOneAndUpdate(
      { user: userId },
      { $inc: { lockedInEscrow: -amountKes, availableBalance: amountKes } },
      { new: false, ...opts }
    );

    if (!oldWallet) throw new Error(`Wallet not found for user ${userId}`);

    const balanceBefore = oldWallet.lockedInEscrow;
    const balanceAfter  = balanceBefore - amountKes;

    await LedgerEntry.create(
      [{
        trade:         tradeId,
        user:          userId,
        type:          'REFUND',
        amountKes,
        balanceBefore,
        balanceAfter,
      }],
      opts
    );

    return {
      ...oldWallet.toObject(),
      lockedInEscrow: balanceAfter,
      availableBalance: oldWallet.availableBalance + amountKes,
    };
  });
};

/**
 * Credits a seller's pending payout balance. This does not move funds from escrow,
 * but rather marks them as ready for future payout. The actual decrement from the
 * buyer's `lockedInEscrow` balance is handled by the `escrow.service`.
 *
 * @param {string | mongoose.Types.ObjectId} userId - The seller's user ID.
 * @param {number} amountKes - The amount to credit to the pending payout balance.
 * @param {string | mongoose.Types.ObjectId} tradeId - The ID of the completed trade.
 * @param {mongoose.ClientSession | null} [session=null] - An optional Mongoose session for transactions.
 * @returns {Promise<import('../models/Wallet.model')>} The updated wallet object.
 * @throws {Error} If payouts are disabled by the platform or the wallet is not found.
 */
const creditPendingPayout = async (userId, amountKes, tradeId, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

    const platformAccount = await PlatformAccount.findOne({}, null, opts);
    if (platformAccount && platformAccount.payoutsEnabled === false) {
      throw new Error('Payouts are currently disabled due to a platform integrity issue');
    }

    const oldWallet = await Wallet.findOneAndUpdate(
      { user: userId },
      { $inc: { pendingPayout: amountKes } },
      { new: false, ...opts }
    );

    if (!oldWallet) throw new Error(`Wallet not found for user ${userId}`);

    const balanceBefore = oldWallet.pendingPayout;
    const balanceAfter  = balanceBefore + amountKes;

    await LedgerEntry.create(
      [{
        trade:         tradeId,
        user:          userId,
        type:          'SELLER_PAYOUT',   // fixed: was ESCROW_RELEASE — seller receives payout
        amountKes,
        balanceBefore,
        balanceAfter,
      }],
      opts
    );

    return { ...oldWallet.toObject(), pendingPayout: balanceAfter };
  });
};

/**
 * Debits a seller's pending payout balance — the counterpart to `creditPendingPayout`, and
 * the moment money genuinely leaves the platform. Called only from the B2C Result callback,
 * once M-Pesa has confirmed the disbursement, so it writes the `WITHDRAWAL` ledger entry
 * that `reconciliation.service` classifies as a debit.
 *
 * Deliberately does NOT check `payoutsEnabled`. The circuit breaker stops *new* payouts from
 * being approved and sent; a Result callback for a disbursement M-Pesa has already made must
 * still be recorded, or the ledger would permanently disagree with reality.
 *
 * @param {string | mongoose.Types.ObjectId} userId - The seller's user ID.
 * @param {number} amountKes - The amount disbursed.
 * @param {string | mongoose.Types.ObjectId} tradeId - The ID of the paid-out trade.
 * @param {mongoose.ClientSession | null} [session=null] - An optional Mongoose session for transactions.
 * @returns {Promise<import('../models/Wallet.model')>} The updated wallet object.
 * @throws {InsufficientFundsError} If `pendingPayout` is below `amountKes`. The `$gte` guard is
 *   the balance-level backstop against a replayed Result callback debiting twice, independent
 *   of the unique `transactionReceipt` index.
 */
const debitPendingPayout = async (userId, amountKes, tradeId, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

    const oldWallet = await Wallet.findOneAndUpdate(
      { user: userId, pendingPayout: { $gte: amountKes } },
      { $inc: { pendingPayout: -amountKes } },
      { new: false, ...opts }
    );

    if (!oldWallet) throw new InsufficientFundsError('Insufficient pending payout balance to disburse');

    const balanceBefore = oldWallet.pendingPayout;
    const balanceAfter  = balanceBefore - amountKes;

    await LedgerEntry.create(
      [{
        trade:         tradeId,
        user:          userId,
        type:          'WITHDRAWAL',
        amountKes,
        balanceBefore,
        balanceAfter,
      }],
      opts
    );

    return { ...oldWallet.toObject(), pendingPayout: balanceAfter };
  });
};

module.exports = {
  InsufficientFundsError,
  credit,
  debit,
  lockFunds,
  unlockFunds,
  creditPendingPayout,
  debitPendingPayout,
};
