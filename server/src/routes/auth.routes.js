const router = require('express').Router();
// TODO: import controller and wire routes
// const ctrl = require('../controllers/auth.controller');
router.get('/', (req, res) => res.json({ route: 'auth', status: 'stub' }));
module.exports = router;
