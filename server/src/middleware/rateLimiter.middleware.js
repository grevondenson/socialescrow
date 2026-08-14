const rateLimit = require('express-rate-limit');
const CONFIG = require('../constants');

// The limiter keeps an in-memory per-IP counter with no reset between requests.
// Under Jest every request shares one IP, so the counter would trip mid-suite and
// 429 legitimate calls. Skip only in the test environment — production is unaffected.
const skipInTest = () => process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.LOGIN.WINDOW_MS,
  max: CONFIG.RATE_LIMIT.LOGIN.MAX,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

const registerLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.REGISTER.WINDOW_MS,
  max: CONFIG.RATE_LIMIT.REGISTER.MAX,
  message: 'Too many registration attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

const searchLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.SEARCH.WINDOW_MS,
  max: CONFIG.RATE_LIMIT.SEARCH.MAX,
  message: 'Too many search requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

const ledgerLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.LEDGER.WINDOW_MS,
  max: CONFIG.RATE_LIMIT.LEDGER.MAX,
  message: 'Too many ledger requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

const tradesLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT.TRADES.WINDOW_MS,
  max: CONFIG.RATE_LIMIT.TRADES.MAX,
  message: 'Too many trade-related requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  searchLimiter,
  ledgerLimiter,
  tradesLimiter,
};
