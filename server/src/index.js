const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { connectDB } = require('./config/db');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

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

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// ── Error handler ────────────────────────────────────────────
app.use(require('./middleware/error.middleware'));

// Export app for testing
module.exports = { app, server };

// ── Start ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 5000;
  connectDB().then(() => {
    server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
  });
}
