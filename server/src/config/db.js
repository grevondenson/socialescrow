const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    // Seed singleton PlatformAccount if it doesn't exist
    const PlatformAccount = require('../models/PlatformAccount.model');
    await PlatformAccount.findOneAndUpdate(
      {},
      {},
      { upsert: true, setDefaultsOnInsert: true }
    );
    console.log('✅ PlatformAccount seeded');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

module.exports = { connectDB };
