const router = require('express').Router();
const walletCtrl = require('../controllers/wallet.controller');
const { protect } = require('../middleware/auth.middleware');

router.get('/',          protect, walletCtrl.getWallet);
router.get('/ledger',    protect, walletCtrl.getLedgerHistory);
router.get('/reconcile', protect, walletCtrl.reconcileMyWallet);

module.exports = router;
