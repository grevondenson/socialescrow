const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  listing:              { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  buyer:                { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  seller:               { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  amountKes:            { type: Number, required: true },
  platformFeeKes:       { type: Number, required: true },
  sellerPayoutKes:      { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending','payment_window','paid','credentials_released','completed','disputed','cancelled'],
    default: 'pending',
  },
  paymentWindowExpires: { type: Date },
  confirmWindowExpires: { type: Date },
  mpesaRef:             { type: String },
  payoutRef:            { type: String },
  cancelledBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelReason:         { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Trade', tradeSchema);
