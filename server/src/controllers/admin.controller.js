const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');

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

module.exports = {
  getAuditLogs,
  banUser,
};
