const User = require('../models/User.model');

const handleKYCWebhook = async (req, res) => {
  try {
    const { userId, kycStatus, kycData } = req.body;

    if (!userId || !kycStatus) {
      return res.status(400).json({ message: 'userId and kycStatus required' });
    }

    if (kycStatus === 'verified') {
      await User.findByIdAndUpdate(userId, {
        kycVerified: true,
        kycVerifiedAt: new Date(),
      });

      res.json({
        message: 'KYC verified successfully',
        kycData,
      });
    } else if (kycStatus === 'rejected') {
      res.status(400).json({
        message: 'KYC verification failed',
        reason: kycData?.reason,
      });
    } else {
      res.json({
        message: 'KYC status pending',
        status: kycStatus,
      });
    }
  } catch (err) {
    console.error('KYC webhook error:', err);
    res.status(500).json({ message: 'KYC webhook processing failed' });
  }
};

module.exports = {
  handleKYCWebhook,
};
