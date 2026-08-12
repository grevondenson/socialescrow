const rateLimit = require('express-rate-limit');

// The limiter keeps an in-memory per-IP counter with no reset between requests.
// Under Jest every request shares one IP, so the counter would trip mid-suite and
// 429 legitimate calls. Skip only in the test environment — production is unaffected.
const skipInTest = () => process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

module.exports = { loginLimiter, registerLimiter };
