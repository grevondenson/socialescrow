const router = require('express').Router();
// TODO: import controller and wire routes
// const ctrl = require('../controllers/listings.controller');
router.get('/', (req, res) => res.json({ route: 'listings', status: 'stub' }));
module.exports = router;
