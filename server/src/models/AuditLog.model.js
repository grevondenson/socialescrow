const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'register', 'login', 'login_failure', 'logout',
      'listing_create', 'trade_create',
      'kyc_submit', 'kyc_verified', 'kyc_mismatch',
      'email_verify_request', 'email_verified'
    ],
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  ip: {
    type: String,
  },
  userAgent: {
    type: String,
  },
  flagged: {
    type: Boolean,
    default: false,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
