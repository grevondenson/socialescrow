const mongoose = require('mongoose');

const platformAccountSchema = new mongoose.Schema({
  escrowPool:            { type: Number, default: 0 }, // All currently locked buyer funds
  revenueBalance:        { type: Number, default: 0 }, // Collected platform fees
  refundReserve:         { type: Number, default: 0 }, // Funds queued for refund
  totalVolumeProcessed:  { type: Number, default: 0 }, // All-time gross trade volume
  lastReconciledAt:      { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('PlatformAccount', platformAccountSchema);
