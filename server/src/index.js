const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose'); // Explicitly import mongoose
const Redis = require('ioredis'); // Explicitly import ioredis
const pinoHttp = require('pino-http');
const { connectDB } = require('./config/db');
require('dotenv').config();
const logger = require('./config/logger');
const performanceMonitor = require('./middleware/performanceMonitor.middleware');
const { checkDarajaHealth, checkCloudinaryHealth } = require('./middleware/healthChecks.middleware');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { startMpesaWorker, stopMpesaWorker } = require('./jobs/mpesa.job');

// ── Security Guard ───────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  // Validate CLIENT_URL to prevent misconfigured CORS
  try {
    new URL(process.env.CLIENT_URL);
  } catch (e) {
    logger.fatal({ err: e, clientUrl: process.env.CLIENT_URL }, 'Invalid CLIENT_URL in environment. Exiting.');
    process.exit(1);
  }

  const key = Buffer.from(process.env.VAULT_ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) {
    logger.fatal('VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Exiting.');
    process.exit(1);
  }
}

const app = express();
const server = http.createServer(app);
let redis; // Declare redis instance globally for access in health checks

// ── Proxy trust ──────────────────────────────────────────────
// Railway terminates TLS at its edge proxy, so the socket peer is always the
// proxy. Without this, req.ip is the proxy address — which silently breaks the
// M-Pesa webhook IP allowlist and mislabels every audit/auth log entry.
// Pin the hop count: a numeric value makes Express take the Nth-from-right entry
// of X-Forwarded-For, so a client-supplied header cannot spoof the source IP.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// ── Middleware ───────────────────────────────────────────────
// Performance monitor must be early to capture the full request lifecycle.
app.use(performanceMonitor);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10kb' })); // Explicit request size limit
app.use(cookieParser());
// Replace morgan with structured JSON logging via pino
app.use(pinoHttp({ logger }));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth.routes'));
app.use('/api/listings', require('./routes/listings.routes'));
app.use('/api/trades',   require('./routes/trades.routes'));
app.use('/api/wallet',   require('./routes/wallet.routes'));
app.use('/api/mpesa',    require('./routes/mpesa.routes'));
app.use('/api/admin',    require('./routes/admin.routes'));
app.use('/api/ai',       require('./routes/ai.routes'));


// ── Health & Readiness Checks ────────────────────────────────
app.get('/health', async (req, res) => {
  const healthStatus = {};

  // Database check
  healthStatus.database = mongoose.connection.readyState === 1 ? { status: 'ok' } : { status: 'degraded', message: 'MongoDB not connected' };

  // Redis check
  healthStatus.redis = redis && redis.status === 'ready' ? { status: 'ok' } : { status: 'degraded', message: 'Redis not connected' };

  // External service checks (Daraja, Cloudinary)
  healthStatus.daraja = await checkDarajaHealth();
  healthStatus.cloudinary = await checkCloudinaryHealth();

  const overallStatus = Object.values(healthStatus).every(s => s.status === 'ok') ? 'ok' : 'degraded';

  res.status(overallStatus === 'ok' ? 200 : 503).json({
    status: overallStatus,
    details: healthStatus,
    uptime: process.uptime(),
  });
});

app.get('/ready', (req, res) => {
  const readinessStatus = {};

  // VAULT_ENCRYPTION_KEY check (already done at startup, but for explicit readiness)
  const vaultKeyValid = Buffer.from(process.env.VAULT_ENCRYPTION_KEY || '', 'hex').length === 32;
  readinessStatus.vaultKey = vaultKeyValid ? { status: 'ok' } : { status: 'not_configured', message: 'VAULT_ENCRYPTION_KEY is invalid' };

  // Database connection and pooling check
  readinessStatus.database = mongoose.connection.readyState === 1 ? { status: 'ok' } : { status: 'not_connected', message: 'MongoDB not connected' };
  // For pooling, we check if maxPoolSize is configured in the environment.
  // A more robust check would inspect mongoose.connections[0].client.s.options.maxPoolSize
  readinessStatus.databasePoolConfigured = process.env.MONGODB_MAX_POOL_SIZE ? { status: 'ok' } : { status: 'warning', message: 'MONGODB_MAX_POOL_SIZE not explicitly set' };

  // Redis connection and pooling check
  readinessStatus.redis = redis && redis.status === 'ready' ? { status: 'ok' } : { status: 'not_connected', message: 'Redis not connected' };
  // Similar to DB, checking if REDIS_POOL_SIZE is set in env.
  readinessStatus.redisPoolConfigured = process.env.REDIS_POOL_SIZE ? { status: 'ok' } : { status: 'warning', message: 'REDIS_POOL_SIZE not explicitly set' };

  const isReady = Object.values(readinessStatus).every(s => s.status === 'ok' || s.status === 'warning'); // Allow warnings for readiness

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not_ready',
    details: readinessStatus,
  });
});

// ── API Documentation ────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Error handler ────────────────────────────────────────────
app.use(require('./middleware/error.middleware'));

// Export app for testing
module.exports = { app, server };

// --- Startup Sequence ---
const startServer = async () => {
  try {
    // 1. Validate environment variables (Redis/Mongo URIs)
    if (!process.env.MONGODB_URI || !process.env.REDIS_URL) {
      logger.fatal('MONGODB_URI and REDIS_URL must be defined. Exiting.');
      process.exit(1);
    }

    // 2. Connect and validate Redis (fail fast)
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1, // Fail fast on commands
      enableOfflineQueue: false, // Don't queue commands if not connected
    });
    redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
    await redis.ping();
    logger.info('Redis connected and validated successfully.');

    // 3. Connect to MongoDB
    await connectDB();

    // 4. Start background workers
    await startMpesaWorker();
    logger.info('M-Pesa BullMQ worker started.');

    // 5. Initialize Sockets
    require('./sockets/trade.socket').initSocket(server);
    logger.info('Socket.io initialized.');

    // 6. Start listening for requests
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}, serving API docs at /api-docs`);
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

// --- Graceful Shutdown ---
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown.`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    await stopMpesaWorker(); // Close BullMQ worker to allow in-flight jobs to finish
    if (redis) await redis.quit();
    await mongoose.disconnect();
    logger.info('All connections closed. Exiting.');
    process.exit(0);
  });

  // Force shutdown after a timeout
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 15000); // 15 seconds
};

// --- Start Application ---
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  startServer();
}
