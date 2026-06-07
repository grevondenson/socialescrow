const router = require('express').Router();
const { protect, requireVerifiedEmail } = require('../middleware/auth.middleware');

router.get('/', (req, res) => res.json({ route: 'listings', status: 'ok' }));

router.post('/', protect, requireVerifiedEmail, (req, res) => {
  res.status(201).json({
    message: 'Listing creation requires full implementation',
    note: 'Email verified gate is active',
  });
});

module.exports = router;
