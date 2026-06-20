const mongoose = require('mongoose');
const dns = require('dns');
const { validateMongoUri } = require('./validateEnv');

const connectDB = async () => {
  const check = validateMongoUri(process.env.MONGODB_URI);
  if (!check.ok) {
    console.error('❌ MongoDB configuration error:', check.reason);
    process.exit(1);
  }

  // Windows often fails SRV lookup with system DNS — use public resolvers
  if (process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

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
    if (err.message?.includes('bad auth') || err.message?.includes('Authentication failed')) {
      console.error('❌ MongoDB authentication failed: check username/password in MONGODB_URI (line 8).');
      console.error('   URL-encode special characters in the password (@ → %40, # → %23).');
    } else if (err.message?.includes('querySrv')) {
      console.error('❌ MongoDB DNS lookup failed:', err.message);
      console.error('   Try the Standard connection string from Atlas (mongodb:// not mongodb+srv://).');
    } else {
      console.error('❌ MongoDB connection failed:', err.message);
    }
    process.exit(1);
  }
};

module.exports = { connectDB };
