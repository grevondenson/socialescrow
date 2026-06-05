const mongoose = require('mongoose');

const escrowSchema = new mongoose.Schema({
  trade:        { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', required: true, unique: true },
  buyer:        { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  seller:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  grossAmount:  { type: Number, required: true },
  platformFee:  { type: Number, required: true },
  sellerPayout: { type: Number, required: true },
  status:       { type: String, enum: ['locked','frozen','released','refunded'], default: 'locked' },
  lockedAt:     { type: Date,   default: Date.now },
  releasedAt:   { type: Date },
  mpesaPayoutRef:{ type: String },
}, { timestamps: true });

module.exports = mongoose.model('EscrowRecord', escrowSchema);
