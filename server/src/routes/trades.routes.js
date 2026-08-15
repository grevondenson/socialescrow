const router = require('express').Router();
const tradesCtrl = require('../controllers/trades.controller');
const vaultCtrl = require('../controllers/vault.controller');
const { protect, requireVerifiedEmail } = require('../middleware/auth.middleware');

// Trade lifecycle
router.post('/', protect, requireVerifiedEmail, tradesCtrl.initiateTrade);
router.get('/:id', protect, tradesCtrl.getTrade);
router.patch('/:id/mock-payment', protect, tradesCtrl.mockPayment);
router.patch('/:id/release', protect, tradesCtrl.releaseCredentials);

// Real-time chat + disputes
router.get('/:id/messages', protect, tradesCtrl.getMessages);
router.post('/:id/messages', protect, tradesCtrl.sendMessage);
router.post('/:id/dispute', protect, tradesCtrl.raiseDispute);

// Vault operations
router.post('/:id/vault', protect, requireVerifiedEmail, vaultCtrl.submitCredentials);
router.get('/:id/vault/reveal', protect, vaultCtrl.revealCredentials);

module.exports = router;
