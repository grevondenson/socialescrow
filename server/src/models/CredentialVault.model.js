const mongoose = require('mongoose');

const vaultSchema = new mongoose.Schema({
  listing:              { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  trade:                { type: mongoose.Schema.Types.ObjectId, ref: 'Trade' },
  encryptedCredentials: { type: String, required: true, select: false },
  iv:                   { type: String, required: true, select: false },
  authTag:              { type: String, required: true, select: false },
  encryptedDataKey:     { type: String, required: true, select: false },
  encryptedDataKeyIv:   { type: String, required: true, select: false },
  keyAuthTag:           { type: String, required: true, select: false },
  encryptionVersion:    { type: String, default: '1' },
  revealed:             { type: Boolean, default: false },
  revealedAt:           { type: Date },
  revealedTo:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expiresAt:            { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('CredentialVault', vaultSchema);
