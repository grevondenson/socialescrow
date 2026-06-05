const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  seller:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform:        { type: String, enum: ['Instagram','TikTok','YouTube','X','Facebook','Snapchat'], required: true },
  followers:       { type: Number, required: true },
  niche:           { type: String, required: true },
  engagementRate:  { type: String },
  accountAgeYears: { type: Number },
  priceKes:        { type: Number, required: true },
  description:     { type: String },
  proofScreenshots:{ type: [String], default: [] },
  status:          { type: String, enum: ['active','in_trade','sold','removed'], default: 'active' },
}, { timestamps: true });

listingSchema.index({ platform: 1, status: 1 });
listingSchema.index({ priceKes: 1 });
listingSchema.index({ '$**': 'text' });

module.exports = mongoose.model('Listing', listingSchema);
