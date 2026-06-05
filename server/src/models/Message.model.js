const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  trade:    { type: mongoose.Schema.Types.ObjectId, ref: 'Trade', required: true },
  sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  type:     { type: String, enum: ['text','image','system'], default: 'text' },
  content:  { type: String, required: true },
  imageUrl: { type: String },
}, { timestamps: true });

messageSchema.index({ trade: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
