const mongoose = require('mongoose');
const logger = require('./logger'); // Import the logger

const connectDB = async () => {
  try {
    const connectionOptions = {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 20, // Default to 20 as per plan
      serverSelectionTimeoutMS: 5000, // Keep trying to connect for 5 seconds
      // Other options like useNewUrlParser, useUnifiedTopology are default in Mongoose 6+
    };

    await mongoose.connect(process.env.MONGODB_URI, connectionOptions);
    logger.info('MongoDB connected successfully.');

    // Seed singleton PlatformAccount if it doesn't exist
    const PlatformAccount = require('../models/PlatformAccount.model');
    await PlatformAccount.findOneAndUpdate(
      {},
      {},
      { upsert: true, setDefaultsOnInsert: true, new: true } // new: true to return the updated doc
    );
    logger.info('PlatformAccount seeded.');
  } catch (err) {
    logger.fatal({ err: err.message }, 'MongoDB connection failed. Exiting.');
    process.exit(1);
  }
};

module.exports = { connectDB };
