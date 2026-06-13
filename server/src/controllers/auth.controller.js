const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User.model');
const Wallet = require('../models/Wallet.model');
const AuditLog = require('../models/AuditLog.model');

const sendRefreshToken = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
};

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
};

const register = async (req, res) => {
  try {
    const { fullName, email, password, confirmPassword } = req.body;

    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken = uuidv4();

    const user = new User({
      fullName,
      email,
      password: hashedPassword,
      verifyToken,
      verifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await user.save();

    const wallet = new Wallet({ user: user._id });
    await wallet.save();

    await AuditLog.create({
      action: 'register',
      userId: user._id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { email },
    });

    const { accessToken, refreshToken } = generateTokens(user._id);
    sendRefreshToken(res, refreshToken);

    res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      accessToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        isVerified: user.isVerified,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      await AuditLog.create({
        action: 'login_failure',
        userId: new User()._id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { email, reason: 'user_not_found' },
      });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: 'User is banned', banReason: user.banReason });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await AuditLog.create({
        action: 'login_failure',
        userId: user._id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { reason: 'invalid_password' },
      });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    await AuditLog.create({
      action: 'login',
      userId: user._id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: {},
    });

    const { accessToken, refreshToken } = generateTokens(user._id);
    sendRefreshToken(res, refreshToken);

    res.json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        isVerified: user.isVerified,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Failed to retrieve user' });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      verifyToken: token,
      verifyExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    user.isVerified = true;
    user.verifyToken = undefined;
    user.verifyExpires = undefined;
    await user.save();

    await AuditLog.create({
      action: 'email_verified',
      userId: user._id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: {},
    });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Verification failed' });
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({ message: 'Refresh token required' });
    }

    const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.isBanned) {
      return res.status(401).json({ message: 'User not found or banned' });
    }

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
    sendRefreshToken(res, newRefreshToken);

    res.json({
      accessToken: newAccessToken,
    });
  } catch (err) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
};

const logout = async (req, res) => {
  try {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Logout failed' });
  }
};

module.exports = {
  register,
  login,
  getMe,
  verifyEmail,
  refreshToken,
  logout,
};
