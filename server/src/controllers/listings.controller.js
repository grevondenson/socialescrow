const Listing = require('../models/Listing.model');
const AuditLog = require('../models/AuditLog.model');
const { uploadStream } = require('../services/cloudinary.service');

const createListing = async (req, res) => {
  try {
    const { platform, followers, niche, engagementRate, accountAgeYears, priceKes, description } = req.body;

    if (!platform || !followers || !niche || !priceKes) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const proofScreenshots = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await uploadStream(file.buffer);
        proofScreenshots.push(result.secure_url);
      }
    }

    const listing = new Listing({
      seller: req.user._id,
      platform,
      followers: Number(followers),
      niche,
      engagementRate,
      accountAgeYears: Number(accountAgeYears),
      priceKes: Number(priceKes),
      description,
      proofScreenshots,
      status: 'active',
    });

    await listing.save();

    await AuditLog.create({
      action: 'listing_create',
      userId: req.user._id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { listingId: listing._id },
    });

    res.status(201).json({ message: 'Listing created successfully', listing });
  } catch (error) {
    console.error('Create listing error:', error);
    res.status(500).json({ message: 'Failed to create listing' });
  }
};

const getListings = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      query, 
      platform, 
      niche, 
      minPrice, 
      maxPrice, 
      sortBy = 'newest' 
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const pipeline = [];

    if (query) {
      pipeline.push({
        $search: {
          index: "default",
          text: {
            query: query,
            path: { wildcard: "*" }
          }
        }
      });
    }

    const matchStage = { status: 'active' };
    if (platform) matchStage.platform = platform;
    if (niche) matchStage.niche = niche;
    if (minPrice || maxPrice) {
      matchStage.priceKes = {};
      if (minPrice) matchStage.priceKes.$gte = parseInt(minPrice, 10);
      if (maxPrice) matchStage.priceKes.$lte = parseInt(maxPrice, 10);
    }
    pipeline.push({ $match: matchStage });

    let sortStage = { createdAt: -1 };
    if (sortBy === 'price_asc') sortStage = { priceKes: 1 };
    else if (sortBy === 'price_desc') sortStage = { priceKes: -1 };
    else if (sortBy === 'followers_desc') sortStage = { followers: -1 };

    if (query && sortBy === 'relevance') {
      sortStage = { score: { $meta: "textScore" } };
    }

    pipeline.push({ $sort: sortStage });
    
    // We get total count before skipping and limiting
    // The safest way is to $facet the results and the count
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $skip: skip },
          { $limit: limitNum },
          {
            $lookup: {
              from: 'users',
              localField: 'seller',
              foreignField: '_id',
              as: 'sellerObj'
            }
          },
          { $unwind: '$sellerObj' },
          {
            $project: {
              platform: 1,
              followers: 1,
              niche: 1,
              priceKes: 1,
              proofScreenshots: 1,
              status: 1,
              createdAt: 1,
              seller: {
                _id: '$sellerObj._id',
                kycName: '$sellerObj.kycName',
                sellerTier: '$sellerObj.sellerTier',
                reputation: '$sellerObj.reputation'
              }
            }
          }
        ]
      }
    });

    const result = await Listing.aggregate(pipeline);
    const listings = result[0].data;
    const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;

    res.json({
      listings,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      }
    });
  } catch (error) {
    console.error('Get listings error:', error);
    res.status(500).json({ message: 'Failed to fetch listings' });
  }
};

const getListingById = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('seller', 'kycName sellerTier reputation');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.json(listing);
  } catch (error) {
    console.error('Get listing by ID error:', error);
    res.status(500).json({ message: 'Failed to fetch listing' });
  }
};

const updateListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this listing' });
    }

    if (listing.status !== 'active' && listing.status !== 'removed') {
      return res.status(400).json({ message: 'Cannot update listing while in trade or sold' });
    }

    const { priceKes, description, status } = req.body;
    
    if (priceKes) listing.priceKes = Number(priceKes);
    if (description) listing.description = description;
    if (status && ['active', 'removed'].includes(status)) listing.status = status;

    await listing.save();

    res.json({ message: 'Listing updated', listing });
  } catch (error) {
    console.error('Update listing error:', error);
    res.status(500).json({ message: 'Failed to update listing' });
  }
};

const deleteListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this listing' });
    }

    if (listing.status === 'in_trade' || listing.status === 'sold') {
      return res.status(400).json({ message: 'Cannot delete listing that is sold or in trade' });
    }

    listing.status = 'removed';
    await listing.save();

    res.json({ message: 'Listing removed successfully' });
  } catch (error) {
    console.error('Delete listing error:', error);
    res.status(500).json({ message: 'Failed to delete listing' });
  }
};

module.exports = {
  createListing,
  getListings,
  getListingById,
  updateListing,
  deleteListing,
};
