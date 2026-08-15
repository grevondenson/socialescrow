const onFinished = require('on-finished');
const logger = require('../config/logger');

/**
 * Middleware to monitor and log the performance of each request.
 * This is a foundational step for future APM integration.
 * It logs the duration of each request to help identify slow endpoints.
 */
const performanceMonitor = (req, res, next) => {
  const start = process.hrtime.bigint();

  onFinished(res, () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    // This provides immediate visibility on performance.
    // For a full APM solution, this log would be replaced with a call
    // to a service like Datadog, New Relic, or Sentry.
    logger.info({
      performance: {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: parseFloat(durationMs.toFixed(3)),
      },
    }, 'Request processed');
  });

  next();
};

module.exports = performanceMonitor;