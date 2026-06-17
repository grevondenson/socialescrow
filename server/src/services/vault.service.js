const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.VAULT_ENCRYPTION_KEY; // Must be 64 char hex (32 bytes)

/**
 * Encrypts plain text using AES-256-CBC
 * @param {string} text - Plain text to encrypt
 * @returns {Object} - { encryptedData: hex, iv: hex }
 */
const encrypt = (text) => {
  if (!ENCRYPTION_KEY) {
    throw new Error('VAULT_ENCRYPTION_KEY is not defined in environment variables');
  }

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex')
  };
};

/**
 * Decrypts hex data using AES-256-CBC
 * @param {string} encryptedData - Hex string of encrypted data
 * @param {string} ivHex - Hex string of IV
 * @returns {string} - Decrypted plain text
 */
const decrypt = (encryptedData, ivHex) => {
  if (!ENCRYPTION_KEY) {
    throw new Error('VAULT_ENCRYPTION_KEY is not defined in environment variables');
  }

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

module.exports = {
  encrypt,
  decrypt
};
