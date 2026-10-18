'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '../lib/socket';

export type TradeSocketState = 'connecting' | 'connected' | 'offline';

/**
 * Joins a trade room and translates server events into React Query invalidations.
 *
 * The server emits from trades.controller / admin.controller:
 *   new_message       -> a chat message (text or system)
 *   trade_completed   -> buyer confirmed; escrow released
 *   dispute_raised    -> escrow frozen
 *   dispute_resolved  -> admin resolved
 *   payout_sent / payout_failed -> B2C outcome (mpesa.controller)
 *
 * Rather than mirroring server state into local React state (which drifts), every event
 * invalidates the trade query and lets the single source of truth re-render. The trade
 * room still polls as a fallback while the socket is not connected.
 */
export function useTradeSocket(tradeId: string | undefined) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TradeSocketState>('connecting');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!tradeId) return;

    const socket = getSocket();
    if (!socket) {
      // No access token yet — the auth probe has not finished. The page keeps polling.
      setState('offline');
      return;
    }

    socketRef.current = socket;
    const invalidateTrade = () =>
      queryClient.invalidateQueries({ queryKey: ['trade', tradeId] });
    const invalidateMessages = () =>
      queryClient.invalidateQueries({ queryKey: ['trade', tradeId, 'messages'] });

    const onConnect = () => {
      setState('connected');
      socket.emit('join_trade', tradeId);
      invalidateTrade();
    };
    const onDisconnect = () => setState('offline');
    const onConnectError = () => setState('offline');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('new_message', invalidateMessages);
    socket.on('trade_completed', invalidateTrade);
    socket.on('dispute_raised', invalidateTrade);
    socket.on('dispute_resolved', invalidateTrade);
    socket.on('payout_sent', invalidateTrade);
    socket.on('payout_failed', invalidateTrade);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.emit('leave_trade', tradeId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('new_message', invalidateMessages);
      socket.off('trade_completed', invalidateTrade);
      socket.off('dispute_raised', invalidateTrade);
      socket.off('dispute_resolved', invalidateTrade);
      socket.off('payout_sent', invalidateTrade);
      socket.off('payout_failed', invalidateTrade);
      disconnectSocket();
      socketRef.current = null;
    };
  }, [tradeId, queryClient]);

  return { state, socket: socketRef.current };
}
