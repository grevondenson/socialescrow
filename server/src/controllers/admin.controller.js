const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const PlatformAccount = require('../models/PlatformAccount.model');
const PayoutQueue = require('../models/PayoutQueue.model');

const Listing = require('../models/Listing.model');
const Trade = require('../models/Trade.model');
const Dispute = require('../models/Dispute.model');
const Message = require('../models/Message.model');
const FraudFlag = require('../models/FraudFlag.model');
const escrowService = require('../services/escrow.service');
const { emitToTrade } = require('../sockets/trade.socket');
const { enqueuePayout } = require('../jobs/payout.job');
const logger = require('../config/logger');
const mongoose = require('mongoose');

const getAuditLogs = async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    const logs = await AuditLog.find()
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await AuditLog.countDocuments();

    res.json({
      logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Get audit logs error:', err);
    res.status(500).json({ message: 'Failed to retrieve audit logs' });
  }
};

const banUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { banReason } = req.body;

    if (!banReason) {
      return res.status(400).json({ message: 'Ban reason is required' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      {
        isBanned: true,
        banReason,
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await AuditLog.create({
      action: 'user_ban',
      userId: req.user.id,
      metadata: { bannedUserId: id, banReason },
    });

    res.json({
      message: 'User banned successfully',
      user,
    });
  } catch (err) {
    console.error('Ban user error:', err);
    res.status(500).json({ message: 'Failed to ban user' });
  }
};

const reviewKycUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, notes } = req.body;

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: "decision must be 'approve' or 'reject'" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.kycVerified = decision === 'approve';
    user.kycReviewRequired = false;
    if (user.kycVerified && !user.kycVerifiedAt) {
      user.kycVerifiedAt = new Date();
    }
    user.kycVerificationMeta = {
      ...user.kycVerificationMeta,
      review: {
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        decision,
        notes,
      }
    };

    await user.save();

    await AuditLog.create({
      action: 'kyc_review',
      userId: req.user.id,
      metadata: { reviewedUserId: id, decision, notes },
    });

    res.json({ message: `KYC ${decision}d`, user });
  } catch (err) {
    console.error('Review KYC error:', err);
    res.status(500).json({ message: 'Failed to review KYC' });
  }
};

const getPendingKycUsers = async (req, res) => {
  try {
    const users = await User.find({ kycReviewRequired: true })
      .select('fullName email kycName kycPhone kycVerified kycVerificationMeta')
      .lean();

    res.json(users);
  } catch (err) {
    console.error('Get pending KYC users error:', err);
    res.status(500).json({ message: 'Failed to fetch KYC review users' });
  }
};

const getAdminListings = async (req, res) => {
  try {
    const listings = await Listing.find().sort({ createdAt: -1 }).populate('seller', 'kycName email');
    res.json(listings);
  } catch (error) {
    console.error('Admin get listings error:', error);
    res.status(500).json({ message: 'Failed to fetch admin listings' });
  }
};

const reviewListing = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, notes } = req.body;

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: "decision must be 'approve' or 'reject'" });
    }

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    listing.moderationStatus = decision === 'approve' ? 'approved' : 'rejected';
    listing.status = decision === 'approve' ? 'active' : 'removed';
    listing.moderationNotes = notes;

    await listing.save();

    await AuditLog.create({
      action: 'listing_moderation',
      userId: req.user.id,
      metadata: { listingId: listing._id, decision, notes },
    });

    res.json({ message: `Listing ${decision}d`, listing });
  } catch (error) {
    console.error('Admin review listing error:', error);
    res.status(500).json({ message: 'Failed to review listing' });
  }
};

const getPlatformAccount = async (req, res) => {
  try {
    const platformAccount = await PlatformAccount.findOne({});
    if (!platformAccount) {
      return res.status(404).json({ message: 'Platform account not found' });
    }

    res.json(platformAccount);
  } catch (error) {
    console.error('Get platform account error:', error);
    res.status(500).json({ message: 'Failed to fetch platform account' });
  }
};

const toggleCircuitBreaker = async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!['trigger', 'clear'].includes(action)) {
      return res.status(400).json({ message: "action must be 'trigger' or 'clear'" });
    }

    const update = action === 'trigger'
      ? {
        payoutsEnabled: false,
        circuitBreakerTriggeredAt: new Date(),
        circuitBreakerReason: reason || 'Admin-triggered circuit breaker',
      }
      : {
        payoutsEnabled: true,
        circuitBreakerTriggeredAt: null,
        circuitBreakerReason: null,
      };

    const platformAccount = await PlatformAccount.findOneAndUpdate(
      {},
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await AuditLog.create({
      action: 'platform_circuit_breaker',
      userId: req.user.id,
      metadata: { action, reason },
    });

    res.json(platformAccount);
  } catch (error) {
    console.error('Toggle circuit breaker error:', error);
    res.status(500).json({ message: 'Failed to update circuit breaker' });
  }
};

const adminRemoveListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    listing.status = 'removed';
    await listing.save();

    await AuditLog.create({
      action: 'listing_remove',
      userId: req.user.id,
      metadata: { action: 'admin_remove_listing', removedListingId: listing._id }
    });

    res.json({ message: 'Listing removed by admin' });
  } catch (error) {
    console.error('Admin remove listing error:', error);
    res.status(500).json({ message: 'Failed to remove listing' });
  }
};

// ── Disputes ─────────────────────────────────────────────────
const getDisputes = async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    const filter = { status: { $ne: 'resolved' } };
    const disputes = await Dispute.find(filter)
      .populate('raisedBy', 'fullName email')
      .populate({ path: 'trade', select: 'amountKes status buyer seller' })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Dispute.countDocuments(filter);

    res.json({
      disputes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Get disputes error:', err);
    res.status(500).json({ message: 'Failed to retrieve disputes' });
  }
};

/**
 * Resolve a dispute one of three ways. All money movement + state changes run in a
 * single transaction; escrow errors (e.g. 503 payouts disabled, 400 bad split) bubble
 * to the error middleware which maps err.statusCode.
 * PATCH /api/admin/disputes/:id/resolve
 */
const resolveDispute = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { resolution, buyerAmount, sellerAmount, adminNotes } = req.body;

    const VALID = ['release_to_seller', 'refund_to_buyer', 'split'];
    if (!VALID.includes(resolution)) {
      await session.abortTransaction();
      return res.status(400).json({ message: `resolution must be one of: ${VALID.join(', ')}` });
    }

    const dispute = await Dispute.findById(id).session(session);
    if (!dispute) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Dispute not found' });
    }
    if (dispute.status === 'resolved') {
      await session.abortTransaction();
      return res.status(409).json({ message: 'Dispute already resolved' });
    }

    const tradeId = dispute.trade.toString();

    if (resolution === 'release_to_seller') {
      await escrowService.release(tradeId, session);
    } else if (resolution === 'refund_to_buyer') {
      await escrowService.refund(tradeId, session);
    } else {
      await escrowService.split(tradeId, Number(buyerAmount), Number(sellerAmount), session);
    }

    dispute.status = 'resolved';
    dispute.resolution = resolution;
    dispute.resolvedBy = req.user.id;
    dispute.resolvedAt = new Date();
    if (adminNotes !== undefined) dispute.adminNotes = adminNotes;
    await dispute.save({ session });

    const [sysMsg] = await Message.create(
      [{
        trade: tradeId,
        sender: req.user.id,
        type: 'system',
        content: `Dispute resolved: ${resolution}`,
      }],
      { session }
    );

    await AuditLog.create(
      [{
        action: 'dispute_resolved',
        userId: req.user.id,
        metadata: { tradeId, disputeId: dispute._id, resolution, buyerAmount, sellerAmount },
      }],
      { session }
    );

    await session.commitTransaction();

    emitToTrade(tradeId, 'new_message', sysMsg);
    emitToTrade(tradeId, 'dispute_resolved', { disputeId: dispute._id, tradeId, resolution });

    res.json(dispute);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ── Payouts (Phase 7: M-Pesa B2C) ────────────────────────────
const PAYOUT_STATUSES = ['pending_approval', 'approved', 'processing', 'sent', 'failed', 'cancelled'];
const FRAUD_RISK_LEVELS = ['low', 'medium', 'high', 'blocked'];

/**
 * Builds an error the central error middleware can map. `statusCode` sets the HTTP status,
 * `code` becomes the machine-readable `error.code` in the response body.
 */
const _httpError = (statusCode, message, code) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
};

/**
 * @desc    List fraud flags, newest first. Optional `?resolved=`, `?riskLevel=` filters.
 * @route   GET /api/admin/fraud-flags?resolved=false&riskLevel=high&page=1&per_page=50
 * @access  Private/Admin
 *
 * FraudFlag has existed (and been written to — VAULT_DOUBLE_REVEAL, WEBHOOK_MISMATCH,
 * RECONCILIATION_MISMATCH) since Phase 3, but nothing could read it back until now.
 */
const getFraudFlags = async (req, res, next) => {
  try {
    const { resolved, riskLevel } = req.query;
    if (riskLevel && !FRAUD_RISK_LEVELS.includes(riskLevel)) {
      throw _httpError(400, `riskLevel must be one of: ${FRAUD_RISK_LEVELS.join(', ')}`, 'INVALID_RISK_LEVEL');
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.per_page, 10) || 50, 1), 100);

    const filter = {};
    if (resolved !== undefined) filter.resolved = resolved === 'true';
    if (riskLevel) filter.riskLevel = riskLevel;

    const [flags, total] = await Promise.all([
      FraudFlag.find(filter)
        .populate('user', 'fullName email')
        .populate({ path: 'trade', select: 'amountKes status buyer seller' })
        .sort({ createdAt: -1 })
        .limit(perPage)
        .skip((page - 1) * perPage)
        .lean(),
      FraudFlag.countDocuments(filter),
    ]);

    res.json({ data: flags, meta: { total, page, per_page: perPage } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List queued payouts, newest first. Optional `?status=` filter.
 * @route   GET /api/admin/payouts?status=pending_approval&page=1&per_page=50
 * @access  Private/Admin
 */
const getPayouts = async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status && !PAYOUT_STATUSES.includes(status)) {
      throw _httpError(400, `status must be one of: ${PAYOUT_STATUSES.join(', ')}`, 'INVALID_STATUS');
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.per_page, 10) || 50, 1), 100);

    const filter = status ? { status } : {};
    const [payouts, total] = await Promise.all([
      PayoutQueue.find(filter)
        .populate('seller', 'fullName email phone')
        .populate({ path: 'trade', select: 'amountKes status buyer seller' })
        .sort({ createdAt: -1 })
        .limit(perPage)
        .skip((page - 1) * perPage)
        .lean(),
      PayoutQueue.countDocuments(filter),
    ]);

    res.json({ data: payouts, meta: { total, page, per_page: perPage } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve a queued payout, clearing it for B2C disbursement.
 * @route   PATCH /api/admin/payouts/:id/approve
 * @access  Private/Admin
 */
const approvePayout = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    let payout;

    // The status flip and its audit entry must agree, so they share one transaction —
    // unlike `toggleCircuitBreaker` above, which can commit the change and then 500.
    await session.withTransaction(async () => {
      const existing = await PayoutQueue.findById(req.params.id).session(session);
      if (!existing) throw _httpError(404, 'Payout not found', 'PAYOUT_NOT_FOUND');

      // Checked before the CAS, so a refused approval leaves the payout at
      // `pending_approval` — approvable again the moment the breaker clears.
      // `payout.service.sendB2C` re-checks it as the last gate before money moves.
      const platformAccount = await PlatformAccount.findOne({}, null, { session });
      if (platformAccount && platformAccount.payoutsEnabled === false) {
        throw _httpError(
          503,
          'Seller payouts are temporarily disabled while platform integrity issues are investigated',
          'PAYOUTS_DISABLED'
        );
      }

      // CAS: two admins clicking approve race for one document. The loser gets null back and
      // never audits an approval that did not happen.
      payout = await PayoutQueue.findOneAndUpdate(
        { _id: req.params.id, status: 'pending_approval' },
        { $set: { status: 'approved', approvedBy: req.user.id, approvedAt: new Date() } },
        { new: true, session }
      );
      if (!payout) {
        throw _httpError(409, `Payout is already ${existing.status} and cannot be approved`, 'PAYOUT_NOT_PENDING');
      }

      await AuditLog.create(
        [{
          action: 'payout_approved',
          userId: req.user.id,
          metadata: {
            tradeId:   payout.trade.toString(),
            payoutId:  payout._id.toString(),
            sellerId:  payout.seller.toString(),
            amountKes: payout.amountKes,
          },
        }],
        { session }
      );
    });

    // Enqueued only after the transaction committed — a job that ran against an uncommitted
    // payout would find nothing. A failed enqueue must never fail the response either: the
    // approval is real and durable, and the worker's startup sweep picks up anything stranded
    // at `approved`. So it is logged, not thrown.
    try {
      await enqueuePayout(payout._id);
    } catch (err) {
      logger.error({ err, payoutId: payout._id.toString() }, 'Payout approved but B2C dispatch could not be enqueued');
    }

    res.json({ data: payout });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reject a queued payout so no B2C disbursement is ever attempted for it.
 * @route   PATCH /api/admin/payouts/:id/reject
 * @access  Private/Admin
 */
const rejectPayout = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { reason } = req.body;
    let payout;

    await session.withTransaction(async () => {
      const existing = await PayoutQueue.findById(req.params.id).session(session);
      if (!existing) throw _httpError(404, 'Payout not found', 'PAYOUT_NOT_FOUND');

      // No circuit-breaker check: stopping a payout is exactly what an admin should be able
      // to do while the breaker is tripped.
      //
      // `approved` is rejectable too — an admin who approved the wrong row needs a way back.
      // This races the `approved` → `processing` CAS in `payout.service.sendB2C`; one side
      // wins, so a payout whose Daraja request is already in flight can never be cancelled.
      //
      // The seller's `pendingPayout` is deliberately untouched: they are still owed the money.
      // Rejecting says "not through this row", not "clawed back", so reconciliation is
      // unaffected. Because `trade` is unique, the trade cannot be re-queued — recovery means
      // putting this row back to `pending_approval`.
      payout = await PayoutQueue.findOneAndUpdate(
        { _id: req.params.id, status: { $in: ['pending_approval', 'approved'] } },
        { $set: { status: 'cancelled' } },
        { new: true, session }
      );
      if (!payout) {
        throw _httpError(409, `Payout is already ${existing.status} and cannot be rejected`, 'PAYOUT_NOT_REJECTABLE');
      }

      await AuditLog.create(
        [{
          action: 'payout_rejected',
          userId: req.user.id,
          metadata: {
            tradeId:   payout.trade.toString(),
            payoutId:  payout._id.toString(),
            sellerId:  payout.seller.toString(),
            amountKes: payout.amountKes,
            reason:    reason || null,
          },
        }],
        { session }
      );
    });

    res.json({ data: payout });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Put a rejected payout back in the queue. `trade` is unique on `PayoutQueue`, so a
 *          cancelled row otherwise blocks that trade's payout forever — this is the way back.
 * @route   PATCH /api/admin/payouts/:id/requeue
 * @access  Private/Admin
 */
const requeuePayout = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { reason } = req.body;
    let payout;

    await session.withTransaction(async () => {
      const existing = await PayoutQueue.findById(req.params.id).session(session);
      if (!existing) throw _httpError(404, 'Payout not found', 'PAYOUT_NOT_FOUND');

      // `cancelled` only, deliberately. A cancelled payout was never sent — `rejectPayout`
      // refuses anything from `processing` on — so re-queueing it cannot double-disburse.
      //
      // `failed` is NOT accepted here. A timeout is weaker evidence than a non-zero ResultCode:
      // Daraja may have paid out and lost the callback. Retrying those has to be gated on a
      // Transaction Status query, not on an admin's guess.
      payout = await PayoutQueue.findOneAndUpdate(
        { _id: req.params.id, status: 'cancelled' },
        {
          $set:   { status: 'pending_approval' },
          // A stale approver on a freshly re-queued row would misattribute the next approval.
          $unset: { approvedBy: '', approvedAt: '' },
        },
        { new: true, session }
      );
      if (!payout) {
        throw _httpError(
          409,
          `Only a cancelled payout can be re-queued; this one is ${existing.status}`,
          'PAYOUT_NOT_CANCELLED'
        );
      }

      await AuditLog.create(
        [{
          action: 'payout_requeued',
          userId: req.user.id,
          metadata: {
            tradeId:   payout.trade.toString(),
            payoutId:  payout._id.toString(),
            sellerId:  payout.seller.toString(),
            amountKes: payout.amountKes,
            reason:    reason || null,
          },
        }],
        { session }
      );
    });

    res.json({ data: payout });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Un-ban a user. The inverse of banUser — the enum, the audit trail and the reason
 * field all mirror it.
 *
 * @route PATCH /api/admin/users/:id/unban
 * @access Private/Admin
 */
const unbanUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { isBanned: false, banReason: null },
      { new: true }
    ).select('-password');

    if (!user) {
      throw _httpError(404, 'User not found', 'USER_NOT_FOUND');
    }

    await AuditLog.create({
      action: 'user_unban',
      userId: req.user.id,
      metadata: { unbannedUserId: id, reason: reason || null },
    });

    res.json({ data: user });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List users for the admin console. Optional `?role=`, `?banned=`, `?q=` (name/email).
 * @route   GET /api/admin/users?role=seller&banned=false&q=wanjiru&page=1&per_page=50
 * @access  Private/Admin
 */
const getUsers = async (req, res, next) => {
  try {
    const { role, banned, q } = req.query;

    if (role && !['buyer', 'seller', 'admin'].includes(role)) {
      throw _httpError(400, "role must be one of: buyer, seller, admin", 'INVALID_ROLE');
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.per_page, 10) || 50, 1), 100);

    const filter = {};
    if (role) filter.role = role;
    if (banned !== undefined) filter.isBanned = banned === 'true';
    if (q) {
      // Escaped so a search for "a+b" cannot become a regex quantifier.
      const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('fullName email phone role isVerified isBanned banReason kycVerified kycName kycPhone sellerTier createdAt')
        .sort({ createdAt: -1 })
        .limit(perPage)
        .skip((page - 1) * perPage)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({ data: users, meta: { total, page, per_page: perPage } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List trades for the admin console. Optional `?status=`, `?q=` (by trade id suffix).
 * @route   GET /api/admin/trades?status=disputed&page=1&per_page=50
 * @access  Private/Admin
 */
const getTrades = async (req, res, next) => {
  try {
    const { status } = req.query;
    const TRADE_STATUSES = [
      'pending', 'payment_window', 'paid', 'credentials_released',
      'completed', 'disputed', 'cancelled',
    ];

    if (status && !TRADE_STATUSES.includes(status)) {
      throw _httpError(400, `status must be one of: ${TRADE_STATUSES.join(', ')}`, 'INVALID_STATUS');
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.per_page, 10) || 50, 1), 100);

    const filter = status ? { status } : {};

    const [trades, total] = await Promise.all([
      Trade.find(filter)
        .populate('buyer', 'fullName email')
        .populate('seller', 'fullName email')
        .populate('listing', 'platform niche priceKes')
        .sort({ createdAt: -1 })
        .limit(perPage)
        .skip((page - 1) * perPage)
        .lean(),
      Trade.countDocuments(filter),
    ]);

    res.json({ data: trades, meta: { total, page, per_page: perPage } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    One round-trip of the counts the overview page needs, so the tiles do not
 *          fan out into five separate requests on a slow connection.
 * @route   GET /api/admin/stats
 * @access  Private/Admin
 */
const getStats = async (req, res, next) => {
  try {
    const [
      pendingPayouts,
      openDisputes,
      openFraudFlags,
      pendingKyc,
      pendingListings,
      pendingManualPayments,
      recentTrades,
    ] = await Promise.all([
      PayoutQueue.countDocuments({ status: { $in: ['pending_approval', 'approved', 'processing'] } }),
      Dispute.countDocuments({ status: { $ne: 'resolved' } }),
      FraudFlag.countDocuments({ resolved: false }),
      User.countDocuments({ kycVerificationMeta: { $exists: true, $ne: null }, kycVerified: false }),
      Listing.countDocuments({ status: 'pending_review' }),
      // Manual payment fallback rows awaiting an admin.
      mongoose.model('MpesaTransaction').countDocuments({
        'manualPayment.status': 'submitted',
        status: 'pending',
      }),
      Trade.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ]);

    res.json({
      data: {
        pendingPayouts,
        openDisputes,
        openFraudFlags,
        pendingKyc,
        pendingListings,
        pendingManualPayments,
        tradesLast7Days: recentTrades,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAuditLogs,
  banUser,
  reviewKycUser,
  getPendingKycUsers,
  getAdminListings,
  reviewListing,
  getPlatformAccount,
  toggleCircuitBreaker,
  adminRemoveListing,
  getDisputes,
  resolveDispute,
  getFraudFlags,
  getPayouts,
  approvePayout,
  rejectPayout,
  requeuePayout,
  unbanUser,
  getUsers,
  getTrades,
  getStats,
};
