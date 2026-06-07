const jwt = require('jsonwebtoken');
const User = require('../models/User.model');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.isBanned) return res.status(401).json({ message: 'User not found or banned' });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: `Role '${req.user?.role}' is not authorized` });
  }
  next();
};

const requireVerifiedEmail = (req, res, next) => {
  if (!req.user?.isVerified) {
    return res.status(403).json({ message: 'Email verification required' });
  }
  next();
};

module.exports = { protect, requireRole, requireVerifiedEmail };

