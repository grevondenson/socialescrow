const Wallet = require('../models/Wallet.model');
const LedgerEntry = require('../models/LedgerEntry.model');
const reconciliationService = require('../services/reconciliation.service');

/**
 * GET /api/wallet
 * Returns the authenticated user's wallet balances.
 */
exports.getWallet = async (req, res, next) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }
    res.json(wallet);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/wallet/ledger
 * Paginated ledger history for the authenticated user.
 * Query params: page (default 1), limit (default 20), type (optional filter)
 */
exports.getLedgerHistory = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = { user: req.user.id };
    if (req.query.type) {
      filter.type = req.query.type;
    }

    const [entries, total] = await Promise.all([
      LedgerEntry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LedgerEntry.countDocuments(filter),
    ]);

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore:    page * limit < total,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/wallet/reconcile
 * Run wallet reconciliation for the authenticated user.
 * Intended for dev/admin use — verify ledger vs wallet balance.
 */
exports.reconcileMyWallet = async (req, res, next) => {
  try {
    const result = await reconciliationService.reconcileWallet(req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
