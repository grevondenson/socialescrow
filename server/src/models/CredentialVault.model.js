const mongoose = require('mongoose');

const vaultSchema = new mongoose.Schema({
  listing:              { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  trade:                { type: mongoose.Schema.Types.ObjectId, ref: 'Trade' },
  encryptedCredentials: { type: String, required: true, select: false },
  revealed:             { type: Boolean, default: false },
  revealedAt:           { type: Date },
  revealedTo:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expiresAt:            { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('CredentialVault', vaultSchema);
