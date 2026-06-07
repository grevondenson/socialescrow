const router = require('express').Router();
const authCtrl = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter.middleware');

router.post('/register', registerLimiter, authCtrl.register);
router.post('/login', loginLimiter, authCtrl.login);
router.get('/me', protect, authCtrl.getMe);
router.get('/verify/:token', authCtrl.verifyEmail);
router.post('/refresh', authCtrl.refreshToken);

module.exports = router;
