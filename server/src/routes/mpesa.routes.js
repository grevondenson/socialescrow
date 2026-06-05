const router = require('express').Router();
// TODO: import controller and wire routes
// const ctrl = require('../controllers/mpesa.controller');
router.get('/', (req, res) => res.json({ route: 'mpesa', status: 'stub' }));
module.exports = router;
