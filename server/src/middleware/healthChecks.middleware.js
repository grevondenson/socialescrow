const logger = require('../config/logger');
// Assuming mpesa.service.js exists and exports necessary functions
const mpesaService = require('../services/mpesa.service');
// Assuming Cloudinary is configured and its v2 API is available
const cloudinary = require('cloudinary').v2;

/**
 * Checks the health of the Daraja (M-Pesa) API by attempting to get an OAuth token.
 * This is a lightweight check to ensure connectivity and credential validity.
 * @returns {Promise<{status: string, message?: string}>}
 */
const checkDarajaHealth = async () => {
  try {
    // Attempt to get an OAuth token. This implicitly checks connectivity and credentials.
    // mpesaService.getOAuthToken() should handle caching internally.
    await mpesaService.getOAuthToken();
    return { status: 'ok' };
  } catch (error) {
    logger.error({ err: error.message }, 'Daraja health check failed');
    return { status: 'degraded', message: error.message };
  }
};

/**
 * Checks the health of the Cloudinary API by attempting a simple API ping.
 * @returns {Promise<{status: string, message?: string}>}
 */
const checkCloudinaryHealth = async () => {
  try {
    // Cloudinary's `api.ping()` is a lightweight way to check credentials and connectivity.
    const result = await cloudinary.api.ping();
    if (result && result.status === 'ok') {
      return { status: 'ok' };
    }
    return { status: 'degraded', message: 'Cloudinary ping did not return "ok"' };
  } catch (error) {
    logger.error({ err: error.message }, 'Cloudinary health check failed');
    return { status: 'degraded', message: error.message };
  }
};

module.exports = {
  checkDarajaHealth,
  checkCloudinaryHealth,
};