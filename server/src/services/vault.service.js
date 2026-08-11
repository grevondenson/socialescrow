const crypto = require('crypto');

const DATA_ALGORITHM = 'aes-256-gcm';
const KEY_ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.VAULT_ENCRYPTION_KEY; // Must be 64 char hex (32 bytes)

const getMasterKey = () => {
  if (!MASTER_KEY) {
    throw new Error('VAULT_ENCRYPTION_KEY is not defined in environment variables');
  }

  const key = Buffer.from(MASTER_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  return key;
};

/**
 * Encrypts plain text with a per-record data key and wraps the key with the master key.
 * @param {string} text - Plain text to encrypt
 * @returns {Object}
 */
const encrypt = (text) => {
  const masterKey = getMasterKey();
  const dataKey = crypto.randomBytes(32);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(DATA_ALGORITHM, dataKey, iv);
  let encryptedData = cipher.update(text, 'utf8', 'hex');
  encryptedData += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  const keyIv = crypto.randomBytes(12);
  const keyCipher = crypto.createCipheriv(KEY_ALGORITHM, masterKey, keyIv);
  const encryptedDataKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
  const keyAuthTag = keyCipher.getAuthTag();

  return {
    encryptedData,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encryptedDataKey: encryptedDataKey.toString('hex'),
    encryptedDataKeyIv: keyIv.toString('hex'),
    keyAuthTag: keyAuthTag.toString('hex'),
    encryptionVersion: '1',
  };
};

/**
 * Decrypts a vault record encrypted with envelope encryption.
 * @param {string} encryptedData - Hex string of encrypted data
 * @param {string} ivHex - Hex string of IV
 * @param {string} authTagHex - Hex string of auth tag
 * @param {string} encryptedDataKeyHex - Hex string of wrapped data key
 * @param {string} encryptedDataKeyIvHex - Hex string of wrapped data key IV
 * @param {string} keyAuthTagHex - Hex string of wrapped data key auth tag
 * @returns {string}
 */
const decrypt = (encryptedData, ivHex, authTagHex, encryptedDataKeyHex, encryptedDataKeyIvHex, keyAuthTagHex) => {
  const masterKey = getMasterKey();

  const encryptedDataKey = Buffer.from(encryptedDataKeyHex, 'hex');
  const keyIv = Buffer.from(encryptedDataKeyIvHex, 'hex');
  const keyAuthTag = Buffer.from(keyAuthTagHex, 'hex');

  const keyDecipher = crypto.createDecipheriv(KEY_ALGORITHM, masterKey, keyIv);
  keyDecipher.setAuthTag(keyAuthTag);
  const dataKey = Buffer.concat([keyDecipher.update(encryptedDataKey), keyDecipher.final()]);

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(DATA_ALGORITHM, dataKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

module.exports = {
  encrypt,
  decrypt,
};
