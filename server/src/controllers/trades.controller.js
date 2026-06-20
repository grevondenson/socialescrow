const Trade = require('../models/Trade.model');
const Listing = require('../models/Listing.model');
const CredentialVault = require('../models/CredentialVault.model');
const walletService = require('../services/wallet.service');
const escrowService = require('../services/escrow.service');
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
    const vaultStatus = !vault ? 'missing' : vault.revealed ? 'revealed' : 'stored';

    // Convert to object to add virtual fields
    const tradeObj = trade.toObject();
    tradeObj.hasVaultCredentials = !!vault;
    tradeObj.vaultRevealed = vault ? vault.revealed : false;
    tradeObj.vaultStatus = vaultStatus;

    res.json(tradeObj);
  } catch (error) {
    next(error);
  }
};

/**
 * Mock payment for testing (migrated to real wallet/escrow services in Phase 4)
 * PATCH /api/trades/:id/mock-payment
 */
exports.mockPayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1. Atomically move trade from payment_window → paid
    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, status: 'payment_window' },
      { $set: { status: 'paid' } },
      { new: true, session }
    );

    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Trade not found or not in payment window' });
    }

    // 2. Credit buyer's wallet (mock deposit) — creates DEPOSIT LedgerEntry with real balances
    await walletService.credit(
      trade.buyer,
      trade.amountKes,
      'DEPOSIT',
      { tradeId: trade._id, note: '[MOCK] Simulated M-Pesa deposit (Phase 4)' },
      session
    );

    // 3. Lock funds into escrow — creates ESCROW_LOCK LedgerEntry + EscrowRecord + PlatformAccount update
    await escrowService.lock(trade._id.toString(), session);

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
