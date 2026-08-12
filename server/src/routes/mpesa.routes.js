const router = require('express').Router();
const mpesaCtrl = require('../controllers/mpesa.controller');
const { protect, requireVerifiedEmail, requireRole } = require('../middleware/auth.middleware');
const { mpesaIpAllowlist } = require('../middleware/mpesaIpAllowlist.middleware');

router.post('/stk-push', protect, requireVerifiedEmail, mpesaCtrl.triggerStkPush);
router.post('/manual-payment', protect, requireVerifiedEmail, mpesaCtrl.submitManualPayment);
router.get('/manual-payment/pending', protect, requireRole('admin'), mpesaCtrl.getPendingManualPayments);
router.patch('/manual-payment/:id/verify', protect, requireRole('admin'), mpesaCtrl.verifyManualPayment);

// Daraja callbacks are unsigned — the IP allowlist is the only source check.
router.post('/webhook/stk-push', mpesaIpAllowlist(), mpesaCtrl.stkPushWebhook);
router.post('/webhook/kyc', mpesaIpAllowlist(), mpesaCtrl.kycWebhook);

router.get('/', (req, res) => res.json({ route: 'mpesa', status: 'live' }));

module.exports = router;
