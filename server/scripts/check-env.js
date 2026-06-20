require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');
const { validateMongoUri } = require('../src/config/validateEnv');

const key = Buffer.from(process.env.VAULT_ENCRYPTION_KEY || '', 'hex');
const mongo = validateMongoUri(process.env.MONGODB_URI);

console.log('VAULT_ENCRYPTION_KEY:', key.length === 32 ? 'OK (32 bytes)' : `INVALID (${key.length} bytes — need 64-char hex)`);
console.log('MONGODB_URI format:', mongo.ok ? 'OK' : `INVALID — ${mongo.reason}`);

if (!mongo.ok || key.length !== 32) process.exit(1);

if (process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => {
    console.log('MONGODB_URI connection: OK');
    return mongoose.disconnect();
  })
  .catch((err) => {
    if (err.message?.includes('bad auth') || err.message?.includes('Authentication failed')) {
      console.log('MONGODB_URI connection: AUTH FAILED — wrong username or password in line 8');
      console.log('  Fix: Atlas → Database Access → edit user password, then update .env');
      console.log('  If password has special chars, URL-encode them (@ → %40)');
    } else {
      console.log('MONGODB_URI connection: FAIL —', err.message);
    }
    process.exit(1);
  });
