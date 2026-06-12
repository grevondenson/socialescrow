const User = require('../models/User.model');

const handleKYCWebhook = async (req, res) => {
  try {
    // Daraja sends MSISDN, FirstName, LastName
    const { MSISDN, FirstName, LastName, kycStatus, kycData } = req.body;

    if (!MSISDN || !kycStatus) {
      return res.status(400).json({ message: 'MSISDN and kycStatus required' });
    }

    // Lookup user by phone
    const user = await User.findOne({ kycPhone: MSISDN });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (kycStatus === 'verified') {
      user.kycVerified = true;
      user.kycVerifiedAt = new Date();
      await user.save();

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
