const router = require('express').Router();
// TODO: import controller and wire routes
// const ctrl = require('../controllers/trades.controller');
router.get('/', (req, res) => res.json({ route: 'trades', status: 'stub' }));
module.exports = router;
