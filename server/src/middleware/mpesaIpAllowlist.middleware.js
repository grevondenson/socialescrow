/**
 * Source-IP allowlist for the M-Pesa (Daraja) webhooks.
 *
 * Daraja callbacks are unsigned — there is no HMAC or shared secret to verify — so
 * the only way to establish that a callback actually came from Safaricom is to
 * validate the source out-of-band. This middleware is that gate.
 *
 * REQUIRES `app.set('trust proxy', N)` (see src/index.js). Behind Railway's edge
 * proxy `req.ip` is the proxy address unless trust proxy is configured, which
 * would make this allowlist a no-op that silently passes everything.
 *
 * Config: MPESA_ALLOWED_IPS — comma-separated IPv4 addresses and/or CIDR blocks,
 * e.g. "196.201.214.200,196.201.214.206,196.201.213.0/24".
 */

const DEFAULT_DENY_MESSAGE = 'Forbidden source';

/**
 * Normalize an address to a plain IPv4 string when possible.
 * Express reports IPv4 peers as IPv4-mapped IPv6 (`::ffff:196.201.214.200`) on
 * dual-stack sockets; the allowlist is written in plain IPv4, so unwrap it.
 */
const normalizeIp = (ip) => {
  if (!ip) return '';
  const value = String(ip).trim();
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  if (value === '::1') return '127.0.0.1';
  return value;
};

/** IPv4 dotted-quad → 32-bit unsigned int. Returns null for anything else. */
const ipv4ToLong = (ip) => {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;

  let long = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    long = (long * 256) + octet;
  }
  return long;
};

/**
 * Does `ip` fall inside `entry`? `entry` is either a bare address (exact match)
 * or an IPv4 CIDR block. Non-IPv4 entries fall back to case-insensitive exact
 * match so an operator can still allowlist a literal IPv6 source.
 */
const ipMatchesEntry = (ip, entry) => {
  const [network, prefixPart] = entry.split('/');

  if (prefixPart === undefined) {
    return ip.toLowerCase() === normalizeIp(network).toLowerCase();
  }

  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const ipLong = ipv4ToLong(ip);
  const networkLong = ipv4ToLong(network);
  if (ipLong === null || networkLong === null) return false;

  if (prefix === 0) return true;
  // >>> 0 keeps the mask unsigned; << 32 is undefined for prefix 0, handled above.
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipLong & mask) === (networkLong & mask);
};

const parseAllowlist = (raw) =>
  String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * @param {object}   [opts]
 * @param {string}   [opts.allowedIps]  - override for MPESA_ALLOWED_IPS (tests)
 * @param {boolean}  [opts.enforce]     - override the NODE_ENV-based enforcement decision
 * @returns {import('express').RequestHandler}
 */
const mpesaIpAllowlist = (opts = {}) => (req, res, next) => {
  // Read env at request time, not module load, so tests can set it in beforeAll.
  const raw = opts.allowedIps !== undefined ? opts.allowedIps : process.env.MPESA_ALLOWED_IPS;
  const allowlist = parseAllowlist(raw);
  const enforce = opts.enforce !== undefined
    ? opts.enforce
    : process.env.NODE_ENV === 'production';

  if (!allowlist.length) {
    if (enforce) {
      // Production with no allowlist is a misconfiguration, not a licence to
      // accept anything — fail closed.
      console.error('M-Pesa webhook rejected: MPESA_ALLOWED_IPS is not configured in production');
      return res.status(403).json({ message: DEFAULT_DENY_MESSAGE });
    }
    console.warn('M-Pesa webhook IP allowlist bypassed: MPESA_ALLOWED_IPS is empty (non-production)');
    return next();
  }

  const clientIp = normalizeIp(req.ip);
  const allowed = allowlist.some((entry) => ipMatchesEntry(clientIp, entry));

  if (allowed) return next();

  if (!enforce) {
    console.warn(`M-Pesa webhook IP allowlist bypassed: ${clientIp || 'unknown'} not allowlisted (non-production)`);
    return next();
  }

  console.error(`M-Pesa webhook rejected: source ${clientIp || 'unknown'} is not allowlisted`);
  // Respond directly — never next(err). The error middleware would surface a 500,
  // and Daraja treats 5xx as retryable, turning rejections into a retry storm.
  return res.status(403).json({ message: DEFAULT_DENY_MESSAGE });
};

module.exports = { mpesaIpAllowlist, normalizeIp, ipMatchesEntry };
