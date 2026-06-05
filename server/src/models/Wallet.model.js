const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  user:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  availableBalance:  { type: Number, default: 0 },
  lockedInEscrow:    { type: Number, default: 0 },
  pendingPayout:     { type: Number, default: 0 },
  totalDeposited:    { type: Number, default: 0 },
  totalWithdrawn:    { type: Number, default: 0 },
  currency:          { type: String, default: 'KES' },
}, { timestamps: true });

module.exports = mongoose.model('Wallet', walletSchema);
