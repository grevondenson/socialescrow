const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const PlatformAccount = require('../models/PlatformAccount.model');

const Listing = require('../models/Listing.model');
const Dispute = require('../models/Dispute.model');
const Message = require('../models/Message.model');
const escrowService = require('../services/escrow.service');
const { emitToTrade } = require('../sockets/trade.socket');
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
      action: 'register',
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
        user: req.user.id,
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
};
