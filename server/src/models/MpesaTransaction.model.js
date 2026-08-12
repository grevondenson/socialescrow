const mongoose = require('mongoose');

const mpesaTransactionSchema = new mongoose.Schema({
  trade:                { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', required: true },
  user:                 { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  checkoutRequestId:    { type: String, unique: true, sparse: true },
  merchantRequestId:    { type: String, sparse: true },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'failed', 'expired'],
    default: 'pending',
  },
  amountKes:            { type: Number, required: true },
  mpesaReceiptNumber:   { type: String, unique: true, sparse: true },
  phoneNumber:          { type: String },
  callbackPayload:      { type: mongoose.Schema.Types.Mixed },
  retryCount:           { type: Number, default: 0 },
  lastPolledAt:         { type: Date },
  manualPayment: {
    referenceCode:      { type: String, unique: true, sparse: true },
    amountKes:          { type: Number },
    status:             { type: String, enum: ['not_requested','pending','submitted','verified','rejected'], default: 'not_requested' },
    submittedAt:        { type: Date },
    verifiedAt:         { type: Date },
    notes:              { type: String },
  },
}, { timestamps: true });

mpesaTransactionSchema.index({ trade: 1 });
mpesaTransactionSchema.index({ user: 1 });

module.exports = mongoose.model('MpesaTransaction', mpesaTransactionSchema);
