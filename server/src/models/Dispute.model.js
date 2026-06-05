const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
  trade:       { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', required: true },
  raisedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  reason:      { type: String, required: true },
  evidence:    { type: [String], default: [] },
  status:      { type: String, enum: ['open','under_review','resolved'], default: 'open' },
  resolution:  { type: String, enum: ['release_to_seller','refund_to_buyer','split'] },
  resolvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt:  { type: Date },
  adminNotes:  { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Dispute', disputeSchema);
