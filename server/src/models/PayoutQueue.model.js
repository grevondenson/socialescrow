const mongoose = require('mongoose');

/**
 * One row per trade payout — the record of money leaving the platform via M-Pesa B2C.
 *
 * Lifecycle: pending_approval → approved → processing → sent
 *                                        ↘ failed (retryable)
 *            pending_approval → cancelled (admin reject)
 *
 * `processing` is set by a CAS from `approved` immediately before the Daraja call, so two
 * concurrent approvals can never both fire a B2C request. `sent` is set only by the Result
 * callback — a B2C `ResponseCode: '0'` means "accepted", not "paid".
 */
const payoutQueueSchema = new mongoose.Schema({
  // unique: one payout per trade. The E11000 is the last-resort double-disbursement backstop,
  // the same guard EscrowRecord relies on at escrow.service.js:45.
  trade:                    { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', required: true, unique: true },
  seller:                   { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  amountKes:                { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending_approval', 'approved', 'processing', 'sent', 'failed', 'cancelled'],
    default: 'pending_approval',
  },

  // Daraja correlation ids. All three are `sparse` because a payout exists (and is queried)
  // long before Daraja is ever called — without sparse, the second unsent payout in the
  // system would collide on a null key.
  originatorConversationId: { type: String, unique: true, sparse: true },
  conversationId:           { type: String, sparse: true },
  transactionReceipt:       { type: String, unique: true, sparse: true },

  approvedBy:               { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt:               { type: Date },
  attempts:                 { type: Number, default: 0 },
  lastError:                { type: String },
  resultPayload:            { type: mongoose.Schema.Types.Mixed },
  queuedAt:                 { type: Date, default: Date.now },
  sentAt:                   { type: Date },
}, { timestamps: true });

// Index for the admin payout queue (GET /api/admin/payouts?status=)
payoutQueueSchema.index({ status: 1, createdAt: -1 });
// Index for a seller's payout history
payoutQueueSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('PayoutQueue', payoutQueueSchema);
