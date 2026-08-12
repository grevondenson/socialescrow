// trade.socket.js — Phase 6: Socket.io trade room (real-time chat + dispute events)
//
// Attaches to the existing http.Server. Auth mirrors the `protect` middleware:
// the client passes its access token via socket.handshake.auth.token, we verify it
// with JWT_SECRET and load the user. A socket may only join `trade:<id>` rooms for
// trades it participates in (buyer/seller) or if it's an admin.
//
// emitToTrade() is a safe no-op when io is uninitialised (e.g. under Jest, where
// initSocket is never called) so controllers can call it unconditionally.

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const Trade = require('../models/Trade.model');

let io = null;

const initSocket = (server) => {
  io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL, credentials: true },
  });

  // Handshake auth — same checks as middleware/auth.middleware.js `protect`.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Not authenticated'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user || user.isBanned) return next(new Error('User not found or banned'));

      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join_trade', async (tradeId) => {
      try {
        const trade = await Trade.findById(tradeId).select('buyer seller');
        if (!trade) return socket.emit('error_message', 'Trade not found');

        const uid = socket.user._id.toString();
        const isParticipant =
          trade.buyer.toString() === uid || trade.seller.toString() === uid;
        if (!isParticipant && socket.user.role !== 'admin') {
          return socket.emit('error_message', 'Not authorized for this trade');
        }

        socket.join(`trade:${tradeId}`);
        socket.emit('joined_trade', tradeId);
      } catch {
        socket.emit('error_message', 'Could not join trade');
      }
    });

    socket.on('leave_trade', (tradeId) => {
      socket.leave(`trade:${tradeId}`);
    });
  });

  return io;
};

/**
 * Broadcast an event to everyone in a trade room.
 * No-op if the socket server hasn't been initialised (tests, or before boot).
 */
const emitToTrade = (tradeId, event, payload) => {
  if (io) io.to(`trade:${tradeId}`).emit(event, payload);
};

module.exports = { initSocket, emitToTrade };
