const router = require('express').Router();
const tradesCtrl = require('../controllers/trades.controller');
const vaultCtrl = require('../controllers/vault.controller');
const { protect, requireVerifiedEmail } = require('../middleware/auth.middleware');

// Trade lifecycle
router.post('/', protect, requireVerifiedEmail, tradesCtrl.initiateTrade);
router.get('/:id', protect, tradesCtrl.getTrade);
router.patch('/:id/mock-payment', protect, tradesCtrl.mockPayment);
router.patch('/:id/release', protect, tradesCtrl.releaseCredentials);

// Vault operations
router.post('/:id/vault', protect, requireVerifiedEmail, vaultCtrl.submitCredentials);
router.get('/:id/vault/reveal', protect, vaultCtrl.revealCredentials);

module.exports = router;
