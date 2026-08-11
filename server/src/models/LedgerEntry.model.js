const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema({
  trade:         { type: mongoose.Schema.Types.ObjectId, ref: 'Trade' },
  user:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['DEPOSIT','ESCROW_LOCK','ESCROW_RELEASE','PLATFORM_FEE','SELLER_PAYOUT','REFUND','DISPUTE_HOLD'],
    required: true,
  },
  amountKes:     { type: Number, required: true },
  balanceBefore: { type: Number, required: true },
  balanceAfter:  { type: Number, required: true },
  reference:     { type: String },
  note:          { type: String },
}, { timestamps: true });

// Ledger is append-only — never update entries
ledgerSchema.pre('save', function(next) {
  if (!this.isNew) {
    return next(new Error('Ledger entries are immutable'));
  }
  next();
});
ledgerSchema.pre('findOneAndUpdate', () => { throw new Error('Ledger entries are immutable'); });
ledgerSchema.pre('updateOne',        () => { throw new Error('Ledger entries are immutable'); });
ledgerSchema.pre('updateMany',       () => { throw new Error('Ledger entries are immutable'); });

// Compound indexes for reconciliation aggregation
ledgerSchema.index({ user: 1, type: 1, createdAt: -1 });
ledgerSchema.index({ trade: 1 });

module.exports = mongoose.model('LedgerEntry', ledgerSchema);
