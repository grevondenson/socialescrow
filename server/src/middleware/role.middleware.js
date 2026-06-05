const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ message: `Role '${req.user?.role}' is not authorized` });
  }
  next();
};

module.exports = { authorize };
