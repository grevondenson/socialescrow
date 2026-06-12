const router = require('express').Router();
const listingsCtrl = require('../controllers/listings.controller');
const { protect, requireVerifiedEmail } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.route('/')
  .get(listingsCtrl.getListings)
  .post(protect, requireVerifiedEmail, upload.array('proofScreenshots', 5), listingsCtrl.createListing);

router.route('/:id')
  .get(listingsCtrl.getListingById)
  .patch(protect, listingsCtrl.updateListing)
  .delete(protect, listingsCtrl.deleteListing);

module.exports = router;
