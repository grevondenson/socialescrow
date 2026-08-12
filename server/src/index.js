const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { connectDB } = require('./config/db');
require('dotenv').config();

// ── Security Guard ───────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const key = Buffer.from(process.env.VAULT_ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) {
    console.error('❌ FATAL: VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    process.exit(1);
  }
}

const app = express();
const server = http.createServer(app);

// ── Proxy trust ──────────────────────────────────────────────
// Railway terminates TLS at its edge proxy, so the socket peer is always the
// proxy. Without this, req.ip is the proxy address — which silently breaks the
// M-Pesa webhook IP allowlist and mislabels every audit/auth log entry.
// Pin the hop count: a numeric value makes Express take the Nth-from-right entry
// of X-Forwarded-For, so a client-supplied header cannot spoof the source IP.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// ── Middleware ───────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth.routes'));
app.use('/api/listings', require('./routes/listings.routes'));
app.use('/api/trades',   require('./routes/trades.routes'));
app.use('/api/wallet',   require('./routes/wallet.routes'));
app.use('/api/mpesa',    require('./routes/mpesa.routes'));
app.use('/api/admin',    require('./routes/admin.routes'));
app.use('/api/ai',       require('./routes/ai.routes'));

const { startMpesaWorker } = require('./jobs/mpesa.job');

startMpesaWorker().catch((err) => {
  console.error('Failed to start M-Pesa BullMQ worker:', err.message || err);
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// ── Error handler ────────────────────────────────────────────
app.use(require('./middleware/error.middleware'));

// Export app for testing
module.exports = { app, server };

// ── Start ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  // Attach Socket.io to the same HTTP server (real-time trade chat + dispute events).
  // Guarded out of tests so no socket handles leak into Jest and emitToTrade() no-ops.
  require('./sockets/trade.socket').initSocket(server);

  const PORT = process.env.PORT || 5000;
  connectDB().then(() => {
    server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
  });
}
