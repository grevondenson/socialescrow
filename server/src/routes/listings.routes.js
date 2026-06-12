const router = require('express').Router();
const listingsCtrl = require('../controllers/listings.controller');
const { protect, requireVerifiedEmail } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const uploadScreenshots = (req, res, next) => {
  upload.array('proofScreenshots', 5)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Too many files uploaded (max 5 allowed)' });
      }
      return res.status(400).json({ message: err.message || 'Upload error' });
    }
    next();
  });
};

router.route('/')
  .get(listingsCtrl.getListings)
  .post(protect, requireVerifiedEmail, uploadScreenshots, listingsCtrl.createListing);

router.route('/:id')
  .get(listingsCtrl.getListingById)
  .patch(protect, listingsCtrl.updateListing)
  .delete(protect, listingsCtrl.deleteListing);

module.exports = router;
