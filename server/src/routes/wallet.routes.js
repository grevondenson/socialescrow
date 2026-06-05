const router = require('express').Router();
// TODO: import controller and wire routes
// const ctrl = require('../controllers/wallet.controller');
router.get('/', (req, res) => res.json({ route: 'wallet', status: 'stub' }));
module.exports = router;
