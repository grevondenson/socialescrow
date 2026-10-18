const Trade = require('../models/Trade.model');
const Listing = require('../models/Listing.model');
const CredentialVault = require('../models/CredentialVault.model');
const MpesaTransaction = require('../models/MpesaTransaction.model');
const PayoutQueue = require('../models/PayoutQueue.model');
const Message = require('../models/Message.model');
const Dispute = require('../models/Dispute.model');
const AuditLog = require('../models/AuditLog.model');
const walletService = require('../services/wallet.service');
const escrowService = require('../services/escrow.service');
const { emitToTrade } = require('../sockets/trade.socket');
const mongoose = require('mongoose');

/**
 * @swagger
 * components:
 *   schemas:
 *     Trade:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated id of the trade.
 *         listing:
 *           type: string
 *           description: The ID of the listing being traded.
 *         buyer:
 *           type: string
 *           description: The ID of the buyer.
 *         seller:
 *           type: string
 *           description: The ID of the seller.
 *         status:
 *           type: string
 *           enum: [pending, payment_window, paid, credentials_released, completed, disputed, cancelled]
 *           description: The current status of the trade.
 *         amountKes:
 *           type: number
 *           description: The total amount of the trade in KES.
 *       example:
 *         _id: 60c72b2f9b1d8c001f8e4d4c
 *         listing: 60c72b2f9b1d8c001f8e4d4a
 *         buyer: 60c72b2f9b1d8c001f8e4d4b
 *         seller: 60c72b2f9b1d8c001f8e4d49
 *         status: 'payment_window'
 *         amountKes: 5000
 */

/**
 * Initiate a new trade
 * POST /api/trades
 */
exports.initiateTrade = async (req, res, next) => {
  try {
    const { listingId } = req.body;

    // 1. Atomic guard against race condition
    const listing = await Listing.findOneAndUpdate(
      { _id: listingId, status: 'active' },
      { $set: { status: 'in_trade' } },
      { new: true }
    );

    if (!listing) {
      return res.status(409).json({ message: 'Listing is no longer active or already in trade' });
    }

    // 2. Prevent buying own listing
    if (listing.seller.toString() === req.user.id) {
      // Revert listing status if it's the seller
      await Listing.findByIdAndUpdate(listingId, { $set: { status: 'active' } });
      return res.status(400).json({ message: 'You cannot initiate a trade on your own listing' });
    }

    // 3. Calculate financials (6% fee)
    const amountKes = listing.priceKes;
    const platformFeeKes = Math.floor(amountKes * 0.06);
    const sellerPayoutKes = amountKes - platformFeeKes;

    // 4. Create trade
    const trade = await Trade.create({
      listing: listingId,
      buyer: req.user.id,
      seller: listing.seller,
      amountKes,
      platformFeeKes,
      sellerPayoutKes,
      status: 'payment_window',
      paymentWindowExpires: new Date(Date.now() + 30 * 60 * 1000) // 30 mins
    });

    res.status(201).json(trade);
  } catch (error) {
    next(error);
  }
};

/**
 * Get trade details
 * GET /api/trades/:id
 * @swagger
 * /api/trades/{id}:
 *   get:
 *     summary: Get details for a specific trade
 *     tags: [Trades]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The trade ID
 *     responses:
 *       200:
 *         description: The trade details.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Trade'
 *       403:
 *         description: Not authorized to view this trade.
 *       404:
 *         description: Trade not found.
 */
exports.getTrade = async (req, res, next) => {
  try {
    const trade = await Trade.findById(req.params.id)
      .populate('listing')
      // `fullName` is the field on User.model. The old `name` selection matched nothing,
      // so both party names were always undefined in the trade room.
      .populate('buyer', 'fullName email kycVerified')
      .populate('seller', 'fullName email kycVerified');

    if (!trade) {
      return res.status(404).json({ message: 'Trade not found' });
    }

    // Auth check
    if (trade.buyer._id.toString() !== req.user.id && trade.seller._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to view this trade' });
    }

    // Check for vault existence (metadata for UI)
    const vault = await CredentialVault.findOne({ trade: trade._id });

    // Convert to object to add virtual fields
    const tradeObj = trade.toObject();
    tradeObj.hasVaultCredentials = !!vault;
    tradeObj.vaultRevealed = vault ? vault.revealed : false;
    // The reveal timestamp drives the status rail's "Revealed once" station; it lives on
    // the vault, not on Trade, so it has to be lifted explicitly.
    tradeObj.vaultRevealedAt = vault?.revealed ? vault.revealedAt ?? null : null;

    const pendingManualPayment = await MpesaTransaction.findOne({
      trade: trade._id,
      'manualPayment.status': 'submitted',
      status: 'pending',
    }).select('manualPayment.referenceCode manualPayment.status manualPayment.submittedAt manualPayment.notes');

    tradeObj.manualPayment = pendingManualPayment ? {
      status: pendingManualPayment.manualPayment.status,
      referenceCode: pendingManualPayment.manualPayment.referenceCode,
      submittedAt: pendingManualPayment.manualPayment.submittedAt,
      notes: pendingManualPayment.manualPayment.notes,
    } : null;

    res.json(tradeObj);
  } catch (error) {
    next(error);
  }
};

/**
 * Mock payment for testing (migrated to real wallet/escrow services in Phase 4)
 * PATCH /api/trades/:id/mock-payment
 */
exports.mockPayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1. Atomically move trade from payment_window → paid
    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, status: 'payment_window' },
      { $set: { status: 'paid' } },
      { new: true, session }
    );

    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Trade not found or not in payment window' });
    }

    // 2. Credit buyer's wallet (mock deposit) — creates DEPOSIT LedgerEntry with real balances
    await walletService.credit(
      trade.buyer,
      trade.amountKes,
      'DEPOSIT',
      { tradeId: trade._id, note: '[MOCK] Simulated M-Pesa deposit (Phase 4)' },
      session
    );

    // 3. Lock funds into escrow — creates ESCROW_LOCK LedgerEntry + EscrowRecord + PlatformAccount update
    await escrowService.lock(trade._id.toString(), session);

    await session.commitTransaction();
    res.json(trade);
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Seller releases credentials to buyer
 * PATCH /api/trades/:id/release
 */
exports.releaseCredentials = async (req, res, next) => {
  try {
    const tradeId = req.params.id;

    // Check if credentials exist in vault
    const vault = await CredentialVault.findOne({ trade: tradeId });
    if (!vault) {
      return res.status(400).json({ message: 'Cannot release: No credentials submitted to vault yet' });
    }

    const trade = await Trade.findOneAndUpdate(
      { 
        _id: tradeId, 
        seller: req.user.id, 
        status: 'paid' 
      },
      { $set: { status: 'credentials_released' } },
      { new: true }
    );

    if (!trade) {
      return res.status(404).json({ message: 'Trade not found, not authorized, or status not paid' });
    }

    res.json(trade);
  } catch (error) {
    next(error);
  }
};

/**
 * Buyer confirms receipt, releasing escrow to the seller and queuing their B2C payout.
 * PATCH /api/trades/:id/confirm
 *
 * This is the happy-path terminal transition. Until it existed, `escrowService.release()` was
 * reachable only from admin dispute resolution, so a trade that both parties were happy with
 * could never move money — it stalled at `credentials_released` forever.
 *
 * `escrowService.release()` performs all the money movement AND sets the trade to `completed`,
 * so this handler only authorizes, validates, and records an audit trail.
 */
exports.confirmReceipt = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const tradeId = req.params.id;

    const trade = await Trade.findById(tradeId).session(session);
    if (!trade) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Trade not found' });
    }

    // Only the buyer may confirm — the seller must not be able to release their own escrow.
    if (trade.buyer.toString() !== req.user.id) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Only the buyer can confirm this trade' });
    }

    // The seller must have released credentials first; `release()` enforces this again, but
    // checking here keeps the error message meaningful instead of surfacing a 400 from below.
    if (trade.status !== 'credentials_released') {
      await session.abortTransaction();
      return res.status(400).json({
        message: 'Trade must be awaiting buyer confirmation before it can be completed',
      });
    }

    // Money movement: seller pendingPayout += sellerPayoutKes, Buyer ESCROW_RELEASE ledger,
    // PlatformAccount updated, EscrowRecord → released, PayoutQueue row created (parked at
    // pending_approval unless AUTO_PAYOUT=true), and Trade → completed.
    await escrowService.release(tradeId, session);

    const [sysMsg] = await Message.create(
      [{
        trade: tradeId,
        sender: req.user.id,
        type: 'system',
        content: `${req.user.fullName} confirmed receipt — escrow released to seller`,
      }],
      { session }
    );

    await AuditLog.create(
      [{
        action: 'trade_confirmed',
        userId: req.user.id,
        metadata: { tradeId, amountKes: trade.amountKes, sellerPayoutKes: trade.sellerPayoutKes },
      }],
      { session }
    );

    await session.commitTransaction();

    // Emit only after the transaction commits.
    emitToTrade(tradeId, 'new_message', sysMsg);
    emitToTrade(tradeId, 'trade_completed', { tradeId });

    const completed = await Trade.findById(tradeId);
    res.json(completed);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ── Helper ───────────────────────────────────────────────────
// Returns true if the authenticated user is the buyer or seller of the trade.
const isParticipant = (trade, userId) =>
  trade.buyer.toString() === userId || trade.seller.toString() === userId;


/**
 * List chat messages for a trade (oldest first).
 * GET /api/trades/:id/messages
 */
exports.getMessages = async (req, res, next) => {
  try {
    const tradeId = req.params.id;
    const trade = await Trade.findById(tradeId).select('buyer seller');
    if (!trade) return res.status(404).json({ message: 'Trade not found' });

    if (!isParticipant(trade, req.user.id)) {
      return res.status(403).json({ message: 'Not authorized to view this trade' });
    }

    const messages = await Message.find({ trade: tradeId })
      .sort({ createdAt: 1 })
      .populate('sender', 'fullName');

    res.json(messages);
  } catch (error) {
    next(error);
  }
};

/**
 * Post a chat message to a trade. Persists to Mongo, then pushes over Socket.io.
 * POST /api/trades/:id/messages
 */
exports.sendMessage = async (req, res, next) => {
  try {
    const tradeId = req.params.id;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const trade = await Trade.findById(tradeId).select('buyer seller');
    if (!trade) return res.status(404).json({ message: 'Trade not found' });

    if (!isParticipant(trade, req.user.id)) {
      return res.status(403).json({ message: 'Not authorized to view this trade' });
    }

    const message = await Message.create({
      trade: tradeId,
      sender: req.user.id,
      type: 'text',
      content: content.trim(),
    });

    await message.populate('sender', 'fullName');
    emitToTrade(tradeId, 'new_message', message);

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};

/**
 * A participant raises a dispute — freezes the escrow so neither side can move funds
 * until an admin resolves it.
 * POST /api/trades/:id/dispute
 */
exports.raiseDispute = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const tradeId = req.params.id;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'A dispute reason is required' });
    }

    const trade = await Trade.findById(tradeId).session(session);
    if (!trade) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Trade not found' });
    }

    if (!isParticipant(trade, req.user.id)) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Not authorized to dispute this trade' });
    }

    // Funds must be locked (paid) and the sale not yet completed/cancelled.
    if (!['paid', 'credentials_released'].includes(trade.status)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Only a paid or credentials-released trade can be disputed' });
    }

    // One open dispute per trade.
    const existing = await Dispute.findOne({ trade: tradeId, status: { $ne: 'resolved' } }).session(session);
    if (existing) {
      await session.abortTransaction();
      return res.status(409).json({ message: 'A dispute is already open for this trade' });
    }

    const [dispute] = await Dispute.create(
      [{ trade: tradeId, raisedBy: req.user.id, reason: reason.trim(), status: 'open' }],
      { session }
    );

    // Trade → disputed, EscrowRecord → frozen, DISPUTE_HOLD ledger (no money moved).
    await escrowService.freeze(tradeId, session);

    const [sysMsg] = await Message.create(
      [{
        trade: tradeId,
        sender: req.user.id,
        type: 'system',
        content: `${req.user.fullName} raised a dispute`,
      }],
      { session }
    );

    await AuditLog.create(
      [{
        action: 'dispute_raised',
        userId: req.user.id,
        metadata: { tradeId, disputeId: dispute._id, reason: reason.trim() },
      }],
      { session }
    );

    await session.commitTransaction();

    // Emit only after the transaction commits.
    emitToTrade(tradeId, 'new_message', sysMsg);
    emitToTrade(tradeId, 'dispute_raised', { disputeId: dispute._id, tradeId });

    res.status(201).json(dispute);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Seller-facing payout state for one trade.
 *
 * PayoutQueue is otherwise admin-only. The seller is entitled to know where their money
 * is — pending approval, approved, sending, sent, or failed — without seeing anyone
 * else's queue. The buyer gets 403: the payout is not their business, and the seller's
 * bank/M-Pesa details sit behind it.
 *
 * GET /api/trades/:id/payout
 */
exports.getTradePayout = async (req, res, next) => {
  try {
    const trade = await Trade.findById(req.params.id).select('seller buyer');
    if (!trade) return res.status(404).json({ message: 'Trade not found' });

    if (trade.seller.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the seller can view this payout' });
    }

    // Lean + explicit select: never leak Daraja payloads or the result blob to the client.
    const payout = await PayoutQueue.findOne({ trade: trade._id })
      .select('status amountKes queuedAt approvedAt sentAt lastError')
      .lean();

    res.json(payout);
  } catch (error) {
    next(error);
  }
};
