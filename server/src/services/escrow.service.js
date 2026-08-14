const Trade = require('../models/Trade.model');
const EscrowRecord = require('../models/EscrowRecord.model');
const LedgerEntry = require('../models/LedgerEntry.model');
const PlatformAccount = require('../models/PlatformAccount.model');
const Wallet = require('../models/Wallet.model');
const walletService = require('./wallet.service');
const CONFIG = require('../constants');

/**
 * Lock buyer funds into escrow for a trade.
 * - wallet.service.lockFunds (buyer availableBalance → lockedInEscrow)
 * - Create EscrowRecord
 * - PlatformAccount.escrowPool += grossAmount
 *
 * Guards against double-lock (idempotent): if EscrowRecord already exists for this trade,
 * throws a 409 instead of letting E11000 bubble as a 500.
 *
 * @param {string} tradeId
 * @param {ClientSession} session - owned by the caller (controller)
 */
const lock = async (tradeId, session) => {
  const opts = { session };

  const trade = await Trade.findById(tradeId).session(session);
  if (!trade) throw new Error('Trade not found');

  // Move buyer's funds: availableBalance → lockedInEscrow
  await walletService.lockFunds(trade.buyer, trade.amountKes, tradeId, session);

  // Create EscrowRecord — guard against duplicate (idempotency / double STK Push)
  try {
    await EscrowRecord.create(
      [{
        trade:        tradeId,
        buyer:        trade.buyer,
        seller:       trade.seller,
        grossAmount:  trade.amountKes,
        platformFee:  trade.platformFeeKes,
        sellerPayout: trade.sellerPayoutKes,
        status:       'locked',
      }],
      opts
    );
  } catch (err) {
    if (err.code === 11000) {
      const dupError = new Error('Escrow already locked for this trade');
      dupError.statusCode = 409;
      throw dupError;
    }
    throw err;
  }

  // Update platform's escrow pool
  await PlatformAccount.findOneAndUpdate(
    {},
    { $inc: { escrowPool: trade.amountKes } },
    { upsert: true, new: true, setDefaultsOnInsert: true, ...opts }
  );
};

/**
 * Release escrow to seller after trade completion.
 * Creates THREE ledger entries:
 *   1. ESCROW_RELEASE  — buyer's lockedInEscrow → 0
 *   2. SELLER_PAYOUT   — seller's pendingPayout += sellerPayoutKes  (via creditPendingPayout)
 *   3. PLATFORM_FEE    — informational, records platform's fee revenue
 *
 * @param {string} tradeId
 * @param {ClientSession} session
 */
const release = async (tradeId, session) => {
  const opts = { session };

  const trade = await Trade.findById(tradeId).session(session);
  if (!trade) throw new Error('Trade not found');

  const platformAccount = await PlatformAccount.findOne({}).session(session);
  if (platformAccount && platformAccount.payoutsEnabled === false) {
    const err = new Error('Seller payouts are temporarily disabled while platform integrity issues are investigated');
    err.statusCode = 503;
    throw err;
  }

  // Accept the normal completion path (credentials_released) AND admin dispute
  // resolution in the seller's favour (disputed). Neither release nor refund is
  // wired to a buyer/seller endpoint, so widening these guards only adds the
  // admin-resolution path.
  if (!['credentials_released', 'disputed'].includes(trade.status)) {
    const err = new Error('Trade must be in credentials_released or disputed status before release');
    err.statusCode = 400;
    throw err;
  }

  const escrowRecord = await EscrowRecord.findOne({ trade: tradeId }).session(session);
  if (!escrowRecord || !['locked', 'frozen'].includes(escrowRecord.status)) {
    const err = new Error('EscrowRecord not found or not in a releasable status');
    err.statusCode = 400;
    throw err;
  }

  // 1. Credit seller's pendingPayout — creates SELLER_PAYOUT LedgerEntry
  await walletService.creditPendingPayout(trade.seller, trade.sellerPayoutKes, tradeId, session);

  // 2. Decrement buyer's lockedInEscrow and create ESCROW_RELEASE LedgerEntry (buyer side)
  const buyerWalletBefore = await Wallet.findOneAndUpdate(
    { user: trade.buyer },
    { $inc: { lockedInEscrow: -trade.amountKes } },
    { new: false, ...opts }
  );

  await LedgerEntry.create(
    [{
      trade:         tradeId,
      user:          trade.buyer,
      type:          'ESCROW_RELEASE',
      amountKes:     trade.amountKes,
      balanceBefore: buyerWalletBefore.lockedInEscrow,
      balanceAfter:  buyerWalletBefore.lockedInEscrow - trade.amountKes,
      note:          `Escrow released to seller for trade ${tradeId}`,
    }],
    opts
  );

  // 3. PLATFORM_FEE LedgerEntry — informational; no wallet attached, user = seller by convention
  await LedgerEntry.create(
    [{
      trade:         tradeId,
      user:          trade.seller,
      type:          'PLATFORM_FEE',
      amountKes:     trade.platformFeeKes,
      balanceBefore: 0,
      balanceAfter:  0,
      note:          `Platform ${CONFIG.PAYMENT.PLATFORM_FEE_PERCENT}% fee for trade ${tradeId}`,
    }],
    opts
  );

  // Update PlatformAccount
  await PlatformAccount.findOneAndUpdate(
    {},
    {
      $inc: {
        escrowPool:           -trade.amountKes,
        revenueBalance:       trade.platformFeeKes,
        totalVolumeProcessed: trade.amountKes,
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, ...opts }
  );

  // Mark EscrowRecord as released
  await EscrowRecord.findOneAndUpdate(
    { trade: tradeId },
    { $set: { status: 'released', releasedAt: new Date() } },
    opts
  );

  // Complete the trade
  await Trade.findByIdAndUpdate(
    tradeId,
    { $set: { status: 'completed' } },
    opts
  );
};

/**
 * Freeze escrow for a disputed trade.
 * NO balance movement — funds remain in buyer's lockedInEscrow.
 * - EscrowRecord status = 'frozen'
 * - Trade status = 'disputed'
 * - DISPUTE_HOLD LedgerEntry (informational audit trail only)
 *
 * @param {string} tradeId
 * @param {ClientSession} session
 */
const freeze = async (tradeId, session) => {
  const opts = { session };

  const trade = await Trade.findById(tradeId).session(session);
  if (!trade) throw new Error('Trade not found');

  const escrowRecord = await EscrowRecord.findOne({ trade: tradeId }).session(session);
  if (!escrowRecord) throw new Error('EscrowRecord not found');

  // No $inc on any wallet field — funds stay in buyer's lockedInEscrow
  await LedgerEntry.create(
    [{
      trade:         tradeId,
      user:          trade.buyer,
      type:          'DISPUTE_HOLD',
      amountKes:     trade.amountKes,
      balanceBefore: 0,
      balanceAfter:  0,
      note:          `Dispute hold for trade ${tradeId}`,
    }],
    opts
  );

  await EscrowRecord.findOneAndUpdate(
    { trade: tradeId },
    { $set: { status: 'frozen' } },
    opts
  );

  await Trade.findByIdAndUpdate(
    tradeId,
    { $set: { status: 'disputed' } },
    opts
  );
};

/**
 * Refund buyer — reverse the escrow lock.
 * - wallet.service.unlockFunds (buyer lockedInEscrow → availableBalance) — creates REFUND LedgerEntry
 * - PlatformAccount.escrowPool -= grossAmount
 * - EscrowRecord status = 'refunded'
 * - Trade status = 'cancelled'
 *
 * @param {string} tradeId
 * @param {ClientSession} session
 */
const refund = async (tradeId, session) => {
  const opts = { session };

  const trade = await Trade.findById(tradeId).session(session);
  if (!trade) throw new Error('Trade not found');

  const escrowRecord = await EscrowRecord.findOne({ trade: tradeId }).session(session);
  if (!escrowRecord || !['locked', 'frozen'].includes(escrowRecord.status)) {
    const err = new Error('EscrowRecord not found or not in a refundable status');
    err.statusCode = 400;
    throw err;
  }

  // Unlock buyer's funds: lockedInEscrow → availableBalance — creates REFUND LedgerEntry
  await walletService.unlockFunds(trade.buyer, trade.amountKes, tradeId, session);

  // Reduce platform escrow pool
  await PlatformAccount.findOneAndUpdate(
    {},
    { $inc: { escrowPool: -trade.amountKes } },
    { upsert: true, new: true, setDefaultsOnInsert: true, ...opts }
  );

  await EscrowRecord.findOneAndUpdate(
    { trade: tradeId },
    { $set: { status: 'refunded' } },
    opts
  );

  await Trade.findByIdAndUpdate(
    tradeId,
    { $set: { status: 'cancelled' } },
    opts
  );
};

/**
 * Split a disputed trade's escrowed deposit between buyer (partial refund) and
 * seller (partial payout). The split is carved out of the buyer's locked deposit
 * (trade.amountKes) — the 6% platform fee is WAIVED on splits.
 *
 * Requires buyerAmount + sellerAmount === trade.amountKes (the gross deposit).
 * Composes existing wallet primitives:
 *   - buyer portion : unlockFunds  (lockedInEscrow → availableBalance) + REFUND ledger
 *   - seller portion: creditPendingPayout (pendingPayout += sellerAmount) + SELLER_PAYOUT
 *                     ledger, plus a direct decrement of the buyer's lockedInEscrow for
 *                     the seller's share + ESCROW_RELEASE ledger (mirrors release()).
 * Net effect: buyer's lockedInEscrow for this trade returns to 0.
 *
 * @param {string} tradeId
 * @param {number} buyerAmount   - refunded to the buyer (>= 0)
 * @param {number} sellerAmount  - paid out to the seller (>= 0)
 * @param {ClientSession} session
 */
const split = async (tradeId, buyerAmount, sellerAmount, session) => {
  const opts = { session };

  const trade = await Trade.findById(tradeId).session(session);
  if (!trade) throw new Error('Trade not found');

  const platformAccount = await PlatformAccount.findOne({}).session(session);
  if (platformAccount && platformAccount.payoutsEnabled === false) {
    const err = new Error('Seller payouts are temporarily disabled while platform integrity issues are investigated');
    err.statusCode = 503;
    throw err;
  }

  const escrowRecord = await EscrowRecord.findOne({ trade: tradeId }).session(session);
  if (!escrowRecord || !['locked', 'frozen'].includes(escrowRecord.status)) {
    const err = new Error('EscrowRecord not found or not in a splittable status');
    err.statusCode = 400;
    throw err;
  }

  if (
    !Number.isFinite(buyerAmount) || !Number.isFinite(sellerAmount) ||
    buyerAmount < 0 || sellerAmount < 0 ||
    buyerAmount + sellerAmount !== trade.amountKes
  ) {
    const err = new Error(`buyerAmount + sellerAmount must equal the escrowed deposit (${trade.amountKes})`);
    err.statusCode = 400;
    throw err;
  }

  // Buyer's refunded share: lockedInEscrow → availableBalance (+ REFUND ledger)
  if (buyerAmount > 0) {
    await walletService.unlockFunds(trade.buyer, buyerAmount, tradeId, session);
  }

  // Seller's payout share
  if (sellerAmount > 0) {
    // pendingPayout += sellerAmount (+ SELLER_PAYOUT ledger)
    await walletService.creditPendingPayout(trade.seller, sellerAmount, tradeId, session);

    // Release the seller's share out of the buyer's lockedInEscrow (+ ESCROW_RELEASE ledger)
    const buyerWalletBefore = await Wallet.findOneAndUpdate(
      { user: trade.buyer },
      { $inc: { lockedInEscrow: -sellerAmount } },
      { new: false, ...opts }
    );

    await LedgerEntry.create(
      [{
        trade:         tradeId,
        user:          trade.buyer,
        type:          'ESCROW_RELEASE',
        amountKes:     sellerAmount,
        balanceBefore: buyerWalletBefore.lockedInEscrow,
        balanceAfter:  buyerWalletBefore.lockedInEscrow - sellerAmount,
        note:          `Escrow split — seller share released for trade ${tradeId}`,
      }],
      opts
    );
  }

  // The whole gross deposit leaves the escrow pool; no fee → no revenue change.
  await PlatformAccount.findOneAndUpdate(
    {},
    { $inc: { escrowPool: -trade.amountKes } },
    { upsert: true, new: true, setDefaultsOnInsert: true, ...opts }
  );

  await EscrowRecord.findOneAndUpdate(
    { trade: tradeId },
    { $set: { status: 'released', releasedAt: new Date() } },
    opts
  );

  await Trade.findByIdAndUpdate(
    tradeId,
    { $set: { status: 'completed' } },
    opts
  );
};

module.exports = { lock, release, freeze, refund, split };
