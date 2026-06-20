const rateLimit = require('express-rate-limit');

const createLimiter = (options) => {
  const limiter = rateLimit(options);
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    return limiter(req, res, next);
  };
};

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, registerLimiter };
