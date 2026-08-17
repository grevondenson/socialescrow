const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'register', 'login', 'login_failure', 'logout',
      'listing_create', 'listing_remove', 'trade_create',
      'kyc_submit', 'kyc_verified', 'kyc_mismatch',
      'email_verify_request', 'email_verified',
      'VAULT_SUBMIT', 'VAULT_REVEAL', 'VAULT_REVEAL_ATTEMPT_FAILED',
      'dispute_raised', 'dispute_resolved',
      // Written by admin.controller.toggleCircuitBreaker — the payout kill switch Phase 7
      // depends on. It was missing, so the audit write threw *after* PlatformAccount had
      // already been updated and the admin got a 500 for a breaker that had actually flipped.
      'platform_circuit_breaker',
      'payout_queued', 'payout_approved', 'payout_rejected', 'payout_requeued',
      'payout_sent', 'payout_failed'
    ],
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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

// Index for admin query to get recent logs
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
