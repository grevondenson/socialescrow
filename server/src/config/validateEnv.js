/**
 * Detect unconfigured MongoDB URI before attempting DNS/connect.
 * @returns {{ ok: boolean, reason?: string }}
 */
const validateMongoUri = (uri) => {
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    return { ok: false, reason: 'MONGODB_URI is missing. Copy your Atlas connection string into server/.env line 8.' };
  }

  const placeholders = ['<user>', '<password>', 'yourpassword', 'cluster.mongodb.net'];
  const hit = placeholders.find((p) => uri.includes(p));
  if (hit) {
    return {
      ok: false,
      reason: `MONGODB_URI still contains placeholder "${hit}". Replace line 8 in server/.env with your real Atlas URI from Database → Connect → Drivers.`,
    };
  }

  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    return { ok: false, reason: 'MONGODB_URI must start with mongodb:// or mongodb+srv://' };
  }

  return { ok: true };
};

module.exports = { validateMongoUri };
