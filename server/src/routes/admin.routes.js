const router = require('express').Router();
const adminCtrl = require('../controllers/admin.controller');
const { protect, requireRole } = require('../middleware/auth.middleware');

router.get('/audit-log', protect, requireRole('admin'), adminCtrl.getAuditLogs);
router.patch('/users/:id/ban', protect, requireRole('admin'), adminCtrl.banUser);
router.get('/users/kyc-review', protect, requireRole('admin'), adminCtrl.getPendingKycUsers);
router.patch('/users/:id/kyc-review', protect, requireRole('admin'), adminCtrl.reviewKycUser);

router.get('/listings', protect, requireRole('admin'), adminCtrl.getAdminListings);
router.patch('/listings/:id/moderation', protect, requireRole('admin'), adminCtrl.reviewListing);
router.patch('/listings/:id/remove', protect, requireRole('admin'), adminCtrl.adminRemoveListing);

router.get('/platform', protect, requireRole('admin'), adminCtrl.getPlatformAccount);
router.patch('/platform/circuit-breaker', protect, requireRole('admin'), adminCtrl.toggleCircuitBreaker);

router.get('/payouts', protect, requireRole('admin'), adminCtrl.getPayouts);
router.patch('/payouts/:id/approve', protect, requireRole('admin'), adminCtrl.approvePayout);
router.patch('/payouts/:id/reject', protect, requireRole('admin'), adminCtrl.rejectPayout);
router.patch('/payouts/:id/requeue', protect, requireRole('admin'), adminCtrl.requeuePayout);

router.get('/disputes', protect, requireRole('admin'), adminCtrl.getDisputes);
router.patch('/disputes/:id/resolve', protect, requireRole('admin'), adminCtrl.resolveDispute);

module.exports = router;
