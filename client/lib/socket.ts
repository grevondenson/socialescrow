'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth/token-store';

/**
 * Socket.io client for the trade room.
 *
 * Two things differ from a naive setup:
 *
 * 1. The access token lives in memory and expires after 15 minutes (ADR 1). The server
 *    reads `handshake.auth.token` once, at connection time. A socket that reconnects an
 *    hour later would present a dead token and be rejected — silently, since the server
 *    just calls `next(new Error(...))`. So `auth` is a *function*: socket.io evaluates it
 *    on every (re)connection attempt and picks up the current token.
 *
 * 2. The socket is not created until a trade room mounts, and is torn down on unmount.
 *    A page-wide singleton would keep a connection open on the marketplace for no reason
 *    and would outlive the auth session.
 */

// The API base includes `/api` (http://localhost:5000/api); socket.io lives on the origin.
export const SOCKET_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api').replace(
  /\/api\/?$/,
  ''
);

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const token = getAccessToken();
  // Nothing to authenticate with — the caller should wait for the auth probe to settle.
  if (!token) return null;

  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        cb({ token: getAccessToken() ?? '' });
      },
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
  }

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * If a token rotation happened while connected (the axios interceptor refreshed it),
 * the existing socket is still authenticated under the old one. Reconnecting forces
 * the handshake to run again with the fresh token.
 */
export function refreshSocketAuth(): void {
  if (socket && socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}
