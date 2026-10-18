const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'register', 'login', 'login_failure', 'logout',
      'listing_create', 'listing_remove', 'trade_create',
      'kyc_submit', 'kyc_verified', 'kyc_mismatch',
      // Admin moderation actions (admin.controller). They were written with names absent from
      // this enum ('kyc_review', 'listing_moderation') and the ban reused 'register', so every
      // one of these audit writes was rejected and silently lost the record.
      'kyc_review', 'listing_moderation', 'user_ban', 'user_unban',
      'email_verify_request', 'email_verified',
      'VAULT_SUBMIT', 'VAULT_REVEAL', 'VAULT_REVEAL_ATTEMPT_FAILED',
      'dispute_raised', 'dispute_resolved',
      // Written by trades.controller.confirmReceipt — the buyer's terminal "received, release
      // the funds" action. Missing from the enum, which made the audit write reject the whole
      // confirm transaction and the endpoint return 400.
      'trade_confirmed',
      // Written by admin.controller.toggleCircuitBreaker — the payout kill switch Phase 7
      // depends on. It was missing, so the audit write threw *after* PlatformAccount had
      // already been updated and the admin got a 500 for a breaker that had actually flipped.
      'platform_circuit_breaker',
      'payout_queued', 'payout_approved', 'payout_rejected', 'payout_requeued',
      'payout_sent', 'payout_failed'
    ],
    required: true,
  },
  // The schema path must be `userId`: that is the field name every writer uses (auth.controller,
  // listings.controller, admin.controller, audit.service) and the name passed to
  // .populate() in admin.controller.getAuditLogs — which throws StrictPopulateError (500) if it
  // does not match. Renamed from `user`, which no writer wrote to.
  userId: {
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
