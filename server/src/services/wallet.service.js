const mongoose = require('mongoose');
const Wallet = require('../models/Wallet.model');
const LedgerEntry = require('../models/LedgerEntry.model');

/**
 * Custom error for insufficient funds
 */
class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient funds') {
    super(message);
    this.name = 'InsufficientFundsError';
    this.statusCode = 400;
  }
}

/**
 * Helper: if caller provides a session we use it (Pattern B — controller-owned).
 * If no session is provided (e.g. standalone admin call), we create and own one
 * with a guaranteed endSession() in the finally block.
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
 * Credit a user's availableBalance.
 * Creates a LedgerEntry of the given type.
 *
 * @param {string} userId
 * @param {number} amountKes
 * @param {string} type  - LedgerEntry type enum value
 * @param {object} meta  - { tradeId?, note?, reference? }
 * @param {ClientSession|null} session
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
 * Debit a user's availableBalance.
 * Uses $gte guard to prevent overdraft — throws InsufficientFundsError (400) if balance is too low.
 *
 * @param {string} userId
 * @param {number} amountKes
 * @param {string} type
 * @param {object} meta
 * @param {ClientSession|null} session
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
 * Atomically move funds from availableBalance → lockedInEscrow.
 * Single $inc on both fields — one findOneAndUpdate, no split-operation risk.
 * Uses $gte guard on availableBalance.
 *
 * @param {string} userId
 * @param {number} amountKes
 * @param {string} tradeId
 * @param {ClientSession|null} session
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
 * Atomically move funds from lockedInEscrow → availableBalance (refund path).
 *
 * @param {string} userId
 * @param {number} amountKes
 * @param {string} tradeId
 * @param {ClientSession|null} session
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
 * Move seller's funds from lockedInEscrow → pendingPayout.
 * NOTE: This operates on the SELLER's wallet only.
 * The BUYER's lockedInEscrow decrement is handled separately in escrow.service.release().
 *
 * @param {string} userId  — seller's userId
 * @param {number} amountKes
 * @param {string} tradeId
 * @param {ClientSession|null} session
 */
const creditPendingPayout = async (userId, amountKes, tradeId, session = null) => {
  return _runInSession(session, async (sess) => {
    const opts = { session: sess };

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

module.exports = {
  InsufficientFundsError,
  credit,
  debit,
  lockFunds,
  unlockFunds,
  creditPendingPayout,
};
