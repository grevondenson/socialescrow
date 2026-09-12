const logger = require('../config/logger');
const { InsufficientFundsError } = require('../services/wallet.service');

/**
 * Centralized error handling middleware.
 * Catches errors, logs them, and sends a standardized JSON response.
 */
const errorMiddleware = (err, req, res, next) => {
  // Log the full error for debugging, especially in development
  logger.error({
    err: {
      name: err.name,
      message: err.message,
      statusCode: err.statusCode,
      stack: err.stack,
    },
    req: {
      id: req.id, // from pino-http
      method: req.method,
      url: req.originalUrl,
    },
  }, 'An error occurred in the request lifecycle');

  let statusCode = err.statusCode || 500;
  let message = err.message || 'An internal server error occurred.';
  let code = err.code || 'INTERNAL_SERVER_ERROR';

  // Handle specific, known error types
  if (err instanceof InsufficientFundsError) {
    statusCode = 400;
    code = 'INSUFFICIENT_FUNDS';
  } else if (err.name === 'ValidationError') { // Mongoose validation
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = Object.values(err.errors).map(e => e.message).join(', ');
  } else if (err.name === 'CastError' && err.kind === 'ObjectId') { // Mongoose invalid ObjectId
    statusCode = 400;
    code = 'INVALID_ID_FORMAT';
    message = `Invalid ID format for resource: ${err.path}`;
  } else if (err.code === 11000) { // Mongoose duplicate key
    statusCode = 409;
    code = 'DUPLICATE_KEY';
    const field = Object.keys(err.keyValue)[0];
    message = `A resource with that ${field} already exists.`;
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'UNAUTHORIZED';
    message = 'Invalid or expired token. Please log in again.';
  }

  // In production, mask generic 500-level errors to avoid leaking implementation details.
  // 503 is exempt: it is never an accident. It is raised deliberately — the payout circuit
  // breaker, escrow refusing to move money — and the message is operator-authored, carries no
  // implementation detail, and is the only thing telling the caller to retry later rather than
  // report a bug.
  if (process.env.NODE_ENV === 'production' && statusCode >= 500 && statusCode !== 503) {
    message = 'An internal server error occurred. Please try again later.';
    code = 'INTERNAL_SERVER_ERROR';
  }

  res.status(statusCode).json({ success: false, error: { code, message } });
};

module.exports = errorMiddleware;