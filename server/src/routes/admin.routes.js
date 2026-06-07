const router = require('express').Router();
const adminCtrl = require('../controllers/admin.controller');
const { protect, requireRole } = require('../middleware/auth.middleware');

router.get('/audit-log', protect, requireRole('admin'), adminCtrl.getAuditLogs);
router.patch('/users/:id/ban', protect, requireRole('admin'), adminCtrl.banUser);

module.exports = router;
