const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { app } = require('../src/index');
const User = require('../src/models/User.model');
const Wallet = require('../src/models/Wallet.model');
const AuditLog = require('../src/models/AuditLog.model');

let mongoServer;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
});

describe('Auth Endpoints', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user and create wallet', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'John Doe',
          email: 'john@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Registration successful');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe('john@example.com');
      expect(res.body.user.isVerified).toBe(false);

      const user = await User.findOne({ email: 'john@example.com' });
      expect(user).toBeDefined();
      expect(user.fullName).toBe('John Doe');

      const wallet = await Wallet.findOne({ user: user._id });
      expect(wallet).toBeDefined();
      expect(wallet.availableBalance).toBe(0);

      const auditLog = await AuditLog.findOne({ userId: user._id, action: 'register' });
      expect(auditLog).toBeDefined();
    });

    it('should not register if passwords do not match', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
          confirmPassword: 'DifferentPassword!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('do not match');
    });

    it('should not register with duplicate email', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'User 1',
          email: 'duplicate@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'User 2',
          email: 'duplicate@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already in use');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Test User',
          email: 'test@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });
    });

    it('should login successfully with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Login successful');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe('test@example.com');

      const auditLog = await AuditLog.findOne({ action: 'login' });
      expect(auditLog).toBeDefined();
    });

    it('should not login with incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid email or password');

      const auditLog = await AuditLog.findOne({ action: 'login_failure' });
      expect(auditLog).toBeDefined();
    });

    it('should not login with non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid email or password');
    });
  });

  describe('GET /api/auth/me', () => {
    let accessToken;

    beforeEach(async () => {
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Me User',
          email: 'me@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      accessToken = registerRes.body.accessToken;
    });

    it('should get current user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('me@example.com');
      expect(res.body.fullName).toBe('Me User');
    });

    it('should not get user without token', async () => {
      const res = await request(app)
        .get('/api/auth/me');

      expect(res.status).toBe(401);
    });
  });

  describe('Email Verification Flow', () => {
    let verifyToken;
    let userId;

    beforeEach(async () => {
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Verify User',
          email: 'verify@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      const user = await User.findOne({ email: 'verify@example.com' });
      userId = user._id;
      verifyToken = user.verifyToken;
    });

    it('should verify email with valid token', async () => {
      const res = await request(app)
        .get(`/api/auth/verify/${verifyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully');

      const user = await User.findById(userId);
      expect(user.isVerified).toBe(true);
    });

    it('should not verify with invalid token', async () => {
      const res = await request(app)
        .get(`/api/auth/verify/invalid-token`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid or expired');
    });
  });

  describe('Listing Creation Gate', () => {
    let accessToken;
    let userId;

    beforeEach(async () => {
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Listing User',
          email: 'listing@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      accessToken = registerRes.body.accessToken;
      const user = await User.findOne({ email: 'listing@example.com' });
      userId = user._id;
    });

    it('should not allow listing creation without email verification', async () => {
      const res = await request(app)
        .post('/api/listings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Test Listing' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Email verification required');
    });

    it('should allow listing creation after email verification', async () => {
      const user = await User.findById(userId);
      const verifyRes = await request(app)
        .get(`/api/auth/verify/${user.verifyToken}`);

      expect(verifyRes.status).toBe(200);

      const listingRes = await request(app)
        .post('/api/listings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Test Listing' });

      expect(listingRes.status).toBe(201);
    });
  });

  describe('Token Refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Refresh User',
          email: 'refresh@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        });

      refreshToken = registerRes.body.refreshToken;
    });

    it('should refresh access token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('should not refresh with invalid token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(401);
    });
  });
});
