const CredentialVault = require('../models/CredentialVault.model');
const Trade = require('../models/Trade.model');
const FraudFlag = require('../models/FraudFlag.model');
const vaultService = require('../services/vault.service');
const auditService = require('../services/audit.service');

/**
 * Seller submits credentials to the vault
 * POST /api/trades/:id/vault
 */
exports.submitCredentials = async (req, res, next) => {
  try {
    const { credentials } = req.body;
    const tradeId = req.params.id;

    const trade = await Trade.findById(tradeId);
    if (!trade) return res.status(404).json({ message: 'Trade not found' });

    // Guard: Only seller can submit, only when status is 'paid'
    if (trade.seller.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the seller can submit credentials' });
    }
    if (trade.status !== 'paid') {
      return res.status(400).json({ message: 'Credentials can only be submitted after payment is confirmed' });
    }

    // Encrypt
    const { encryptedData, iv } = vaultService.encrypt(credentials);

    // Upsert vault entry
    const vault = await CredentialVault.findOneAndUpdate(
      { trade: tradeId },
      { 
        listing: trade.listing,
        trade: tradeId,
        encryptedCredentials: encryptedData,
        iv,
        revealed: false
      },
      { upsert: true, new: true }
    );

    await auditService.log('VAULT_SUBMIT', req, { tradeId });

    res.status(200).json({ message: 'Credentials securely stored in vault' });
  } catch (error) {
    next(error);
  }
};

/**
 * Buyer reveals credentials (atomic)
 * GET /api/trades/:id/vault/reveal
 */
exports.revealCredentials = async (req, res, next) => {
  try {
    const tradeId = req.params.id;

    const trade = await Trade.findById(tradeId);
    if (!trade) return res.status(404).json({ message: 'Trade not found' });

    // Guard: Only buyer can reveal, only when status is 'credentials_released'
    if (trade.buyer.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the buyer can reveal credentials' });
    }
    if (trade.status !== 'credentials_released') {
      return res.status(400).json({ message: 'Credentials have not been released by the seller yet' });
    }

    // Atomic reveal
    const vault = await CredentialVault.findOneAndUpdate(
      { trade: tradeId, revealed: false },
      { 
        revealed: true, 
        revealedAt: new Date(), 
        revealedTo: req.user.id 
      },
      { new: true, select: '+encryptedCredentials iv' }
    );

    if (!vault) {
      // Check if it was already revealed
      const alreadyRevealed = await CredentialVault.findOne({ trade: tradeId, revealed: true });
      if (alreadyRevealed) {
        await FraudFlag.create({
          user: req.user.id,
          trade: tradeId,
          flagType: 'VAULT_DOUBLE_REVEAL',
          riskScore: 80,
          riskLevel: 'high',
          note: 'Attempted to reveal credentials that were already revealed'
        });
        await auditService.log('VAULT_REVEAL_ATTEMPT_FAILED', req, { tradeId, reason: 'already_revealed' });
        return res.status(410).json({ message: 'Credentials have already been revealed and are no longer available' });
      }
      return res.status(404).json({ message: 'Vault entry not found' });
    }

    // Decrypt
    const decrypted = vaultService.decrypt(vault.encryptedCredentials, vault.iv);

    await auditService.log('VAULT_REVEAL', req, { tradeId });

    res.status(200).json({ credentials: decrypted });
  } catch (error) {
    next(error);
  }
};
