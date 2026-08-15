// Centralized configuration constants to avoid magic numbers in the codebase.

// Time constants in milliseconds for readability
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

const CONFIG = {
  // JWT expiry times, aligned with best practices
  JWT: {
    ACCESS_EXPIRES: '15m',
    REFRESH_EXPIRES: '30d',
  },

  // Payment and trade window configurations
  PAYMENT: {
    WINDOW_MINUTES: 30,
    CONFIRM_HOURS: 24,
    PLATFORM_FEE_PERCENT: 6,
  },

  // Rate limits for various endpoints, sourced from rateLimiter.middleware.js
  RATE_LIMIT: {
    LOGIN: { WINDOW_MS: 15 * ONE_MINUTE_MS, MAX: 5 },
    REGISTER: { WINDOW_MS: ONE_HOUR_MS, MAX: 5 },
    SEARCH: { WINDOW_MS: ONE_MINUTE_MS, MAX: 10 },
    LEDGER: { WINDOW_MS: ONE_MINUTE_MS, MAX: 20 },
    TRADES: { WINDOW_MS: ONE_MINUTE_MS, MAX: 50 },
  },

  // Default connection pool sizes
  POOLS: {
    MONGODB_MAX: Number(process.env.MONGODB_MAX_POOL_SIZE) || 20,
    REDIS_MAX: Number(process.env.REDIS_POOL_SIZE) || 10,
  },

  // Default time range for audit log queries
  AUDIT: {
    DEFAULT_DAYS_BACK: 7,
  },
};

module.exports = CONFIG;