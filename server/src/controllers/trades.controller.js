const Trade = require('../models/Trade.model');
const Listing = require('../models/Listing.model');
const EscrowRecord = require('../models/EscrowRecord.model');
const LedgerEntry = require('../models/LedgerEntry.model');
const Wallet = require('../models/Wallet.model');
const CredentialVault = require('../models/CredentialVault.model');
const mongoose = require('mongoose');

/**
 * Initiate a new trade
 * POST /api/trades
 */
exports.initiateTrade = async (req, res, next) => {
  try {
    const { listingId } = req.body;

    // 1. Atomic guard against race condition
    const listing = await Listing.findOneAndUpdate(
      { _id: listingId, status: 'active' },
      { $set: { status: 'in_trade' } },
      { new: true }
    );

    if (!listing) {
      return res.status(409).json({ message: 'Listing is no longer active or already in trade' });
    }

    // 2. Prevent buying own listing
    if (listing.seller.toString() === req.user.id) {
      // Revert listing status if it's the seller
      await Listing.findByIdAndUpdate(listingId, { $set: { status: 'active' } });
      return res.status(400).json({ message: 'You cannot initiate a trade on your own listing' });
    }

    // 3. Calculate financials (6% fee)
    const amountKes = listing.priceKes;
    const platformFeeKes = Math.floor(amountKes * 0.06);
    const sellerPayoutKes = amountKes - platformFeeKes;

    // 4. Create trade
    const trade = await Trade.create({
      listing: listingId,
      buyer: req.user.id,
      seller: listing.seller,
      amountKes,
      platformFeeKes,
      sellerPayoutKes,
      status: 'payment_window',
      paymentWindowExpires: new Date(Date.now() + 30 * 60 * 1000) // 30 mins
    });

    res.status(201).json(trade);
  } catch (error) {
    next(error);
  }
};

/**
 * Get trade details
 * GET /api/trades/:id
 */
exports.getTrade = async (req, res, next) => {
  try {
    const trade = await Trade.findById(req.params.id)
      .populate('listing')
      .populate('buyer', 'name email kycVerified')
      .populate('seller', 'name email kycVerified');

    if (!trade) {
      return res.status(404).json({ message: 'Trade not found' });
    }

    // Auth check
    if (trade.buyer._id.toString() !== req.user.id && trade.seller._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to view this trade' });
    }

    // Check for vault existence (metadata for UI)
    const vault = await CredentialVault.findOne({ trade: trade._id });

    // Convert to object to add virtual fields
    const tradeObj = trade.toObject();
    tradeObj.hasVaultCredentials = !!vault;
    tradeObj.vaultRevealed = vault ? vault.revealed : false;

    res.json(tradeObj);
  } catch (error) {
    next(error);
  }
};

/**
 * Mock payment for Phase 3 testing
 * PATCH /api/trades/:id/mock-payment
 */
exports.mockPayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, status: 'payment_window' },
      { $set: { status: 'paid' } },
      { new: true, session }
    );

    if (!trade) {
      throw new Error('Trade not found or not in payment window');
    }

    // Create EscrowRecord
    await EscrowRecord.create([{
      trade: trade._id,
      buyer: trade.buyer,
      seller: trade.seller,
      grossAmount: trade.amountKes,
      platformFee: trade.platformFeeKes,
      sellerPayout: trade.sellerPayoutKes,
      status: 'locked'
    }], { session });

    // Update Buyer Wallet (Mock deposit + lock)
    const wallet = await Wallet.findOne({ user: trade.buyer }).session(session);
    if (!wallet) throw new Error('Buyer wallet not found');

    const balanceBeforeDeposit = wallet.availableBalance;
    wallet.availableBalance += trade.amountKes;
    wallet.totalDeposited += trade.amountKes;
    const balanceAfterDeposit = wallet.availableBalance;

    // Create DEPOSIT ledger
    await LedgerEntry.create([{
      trade: trade._id,
      user: trade.buyer,
      type: 'DEPOSIT',
      amountKes: trade.amountKes,
      balanceBefore: balanceBeforeDeposit,
      balanceAfter: balanceAfterDeposit,
      note: '[MOCK] Mock deposit for Phase 3'
    }], { session });

    // Lock funds
    const balanceBeforeLock = wallet.availableBalance;
    wallet.availableBalance -= trade.amountKes;
    wallet.lockedInEscrow += trade.amountKes;
    const balanceAfterLock = wallet.availableBalance;

    // Create ESCROW_LOCK ledger
    await LedgerEntry.create([{
      trade: trade._id,
      user: trade.buyer,
      type: 'ESCROW_LOCK',
      amountKes: trade.amountKes,
      balanceBefore: balanceBeforeLock,
      balanceAfter: balanceAfterLock,
      note: '[MOCK] Mock escrow lock for Phase 3'
    }], { session });

    await wallet.save({ session });

    await session.commitTransaction();
    res.json(trade);
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Seller releases credentials to buyer
 * PATCH /api/trades/:id/release
 */
exports.releaseCredentials = async (req, res, next) => {
  try {
    const tradeId = req.params.id;

    // Check if credentials exist in vault
    const vault = await CredentialVault.findOne({ trade: tradeId });
    if (!vault) {
      return res.status(400).json({ message: 'Cannot release: No credentials submitted to vault yet' });
    }

    const trade = await Trade.findOneAndUpdate(
      { 
        _id: tradeId, 
        seller: req.user.id, 
        status: 'paid' 
      },
      { $set: { status: 'credentials_released' } },
      { new: true }
    );

    if (!trade) {
      return res.status(404).json({ message: 'Trade not found, not authorized, or status not paid' });
    }

    res.json(trade);
  } catch (error) {
    next(error);
  }
};
