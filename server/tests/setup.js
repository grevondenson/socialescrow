const mongoose = require('mongoose');
require('dotenv').config();

let mongoServer;

const getTestMongoUri = async () => {
  const atlasUri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
  if (atlasUri && !atlasUri.includes('<user>')) {
    return atlasUri;
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongoServer = await MongoMemoryServer.create();
  return mongoServer.getUri();
};

const connectTestDB = async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
  process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'test-refresh-secret';

  const uri = await getTestMongoUri();
  await mongoose.connect(uri);
};

const disconnectTestDB = async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
};

const clearCollections = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

module.exports = { connectTestDB, disconnectTestDB, clearCollections };
