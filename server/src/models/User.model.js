const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName:        { type: String, required: true, trim: true },
  email:           { type: String, required: true, unique: true, lowercase: true },
  password:        { type: String, required: true, select: false },
  phone:           { type: String },
  role:            { type: String, enum: ['buyer', 'seller', 'admin'], default: 'buyer' },
  isVerified:      { type: Boolean, default: false },
  verifyToken:     { type: String, select: false },
  verifyExpires:   { type: Date,   select: false },
  resetToken:      { type: String, select: false },
  resetExpires:    { type: Date,   select: false },
  isBanned:        { type: Boolean, default: false },
  banReason:       { type: String },
  kycName:             { type: String },
  kycPhone:            { type: String, unique: true, sparse: true },
  kycVerified:         { type: Boolean, default: false },
  kycVerifiedAt:       { type: Date },
  kycReviewRequired:   { type: Boolean, default: false },
  kycVerificationMeta: { type: mongoose.Schema.Types.Mixed },
  sellerTier:          { type: String, enum: ['none', 'verified', 'trusted', 'top_seller'], default: 'none' },
  reputation: {
    totalTrades:    { type: Number, default: 0 },
    completedTrades:{ type: Number, default: 0 },
    rating:         { type: Number, default: 0 },
    reviewCount:    { type: Number, default: 0 },
  },
}, { timestamps: true });

// Index for admin query to find users needing KYC review
userSchema.index({ kycReviewRequired: 1 });

module.exports = mongoose.model('User', userSchema);
