const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');

const Listing = require('../models/Listing.model');

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

const getAdminListings = async (req, res) => {
  try {
    const listings = await Listing.find().sort({ createdAt: -1 }).populate('seller', 'kycName email');
    res.json(listings);
  } catch (error) {
    console.error('Admin get listings error:', error);
    res.status(500).json({ message: 'Failed to fetch admin listings' });
  }
};

const adminRemoveListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    
    listing.status = 'removed';
    await listing.save();

    await AuditLog.create({
      action: 'listing_create', // Fallback to an existing enum action if listing_remove doesn't exist, we'll log it in metadata
      userId: req.user.id,
      metadata: { action: 'admin_remove_listing', removedListingId: listing._id }
    });

    res.json({ message: 'Listing removed by admin' });
  } catch (error) {
    console.error('Admin remove listing error:', error);
    res.status(500).json({ message: 'Failed to remove listing' });
  }
};

module.exports = {
  getAuditLogs,
  banUser,
  getAdminListings,
  adminRemoveListing,
};
