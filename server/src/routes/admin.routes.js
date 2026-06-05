const router = require('express').Router();
// TODO: import controller and wire routes
// const ctrl = require('../controllers/admin.controller');
router.get('/', (req, res) => res.json({ route: 'admin', status: 'stub' }));
module.exports = router;
