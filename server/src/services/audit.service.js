const AuditLog = require('../models/AuditLog.model');

/**
 * Logs a high-risk action
 * @param {string} action - Action name (e.g., 'VAULT_SUBMIT')
 * @param {Object} req - Express request object (to extract IP/UA)
 * @param {Object} metadata - Additional info
 */
exports.log = async (action, req, metadata = {}) => {
  try {
    await AuditLog.create({
      user: req.user?.id,
      action,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      metadata
    });
  } catch (error) {
    console.error('Audit log failed:', error);
  }
};
