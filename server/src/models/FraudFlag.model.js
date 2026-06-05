const mongoose = require('mongoose');

const fraudFlagSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trade:      { type: mongoose.Schema.Types.ObjectId, ref: 'Trade' },
  flagType: {
    type: String,
    enum: [
      'NEW_ACCOUNT_HIGH_VALUE','MULTIPLE_DISPUTES','DUPLICATE_PHONE',
      'IP_MISMATCH','RAPID_LISTINGS','SUSPICIOUS_CANCEL','WEBHOOK_MISMATCH'
    ],
  },
  riskScore:  { type: Number, default: 0 },
  riskLevel:  { type: String, enum: ['low','medium','high','blocked'], default: 'low' },
  resolved:   { type: Boolean, default: false },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note:       { type: String },
}, { timestamps: true });

module.exports = mongoose.model('FraudFlag', fraudFlagSchema);
