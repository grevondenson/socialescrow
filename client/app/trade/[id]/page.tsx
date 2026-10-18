'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../../components/layout/AppShell';
import { TradeRoom } from '../../../components/trade/TradeRoom';
import { ErrorState, Skeleton } from '../../../components/ui/States';
import { useTradeSocket } from '../../../hooks/useTradeSocket';
import { api } from '../../../lib/api';
import { fetchTrade, fetchTradePayout, type Trade } from '../../../lib/services/trade';

interface Me {
  _id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  role?: string;
}

/**
 * Trade room route.
 *
 * Deliberately thin: fetch, gate, hand off. All interaction lives in
 * components/trade/*. The socket joins the room as soon as the trade is known, and the
 * query only polls while the socket is not connected (3s was previously unconditional,
 * which burned battery and bandwidth on a connection that already had live updates).
 */
export default function TradeRoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data as Me,
  });

  const tradeQuery = useQuery({
    queryKey: ['trade', id],
    queryFn: () => fetchTrade(id),
    enabled: Boolean(id),
    // Fallback only — the socket invalidates this query on every state change.
    refetchInterval: (query) => (query.state.data ? 15_000 : false),
    refetchOnWindowFocus: true,
  });

  const { state: socketState } = useTradeSocket(id);

  const me = meQuery.data;
  const trade = tradeQuery.data;
  const isSeller = Boolean(me && trade && me._id === trade.seller?._id?.toString());

  // Seller-only payout state. Fetched separately because the admin payout row is not
  // part of the trade document and must not be exposed to the buyer.
  const payoutQuery = useQuery({
    queryKey: ['trade', id, 'payout'],
    queryFn: () => fetchTradePayout(id),
    enabled: isSeller,
    refetchInterval: socketState === 'connected' ? false : 20_000,
  });

  // 401 after the refresh-and-retry chain is exhausted: send them to sign in, then back.
  useEffect(() => {
    if (meQuery.isError) {
      const status = (meQuery.error as { response?: { status?: number } })?.response?.status;
      if (status === 401) router.replace(`/login?next=/trade/${id}`);
    }
  }, [meQuery.isError, meQuery.error, router, id]);

  if (tradeQuery.isLoading || meQuery.isLoading) {
    return (
      <AppShell width="default">
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-6 lg:grid-cols-3">
            <Skeleton className="h-72 lg:col-span-2" />
            <Skeleton className="h-72" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (tradeQuery.isError) {
    const status = (tradeQuery.error as { response?: { status?: number } })?.response?.status;
    const forbidden = status === 403 || status === 404;
    return (
      <AppShell width="default">
        <ErrorState
          title={forbidden ? 'This trade is not yours to view' : 'The trade room did not load'}
          description={
            forbidden
              ? 'Only the buyer and the seller can open a trade room.'
              : undefined
          }
          onRetry={() => void tradeQuery.refetch()}
        />
      </AppShell>
    );
  }

  if (!trade) {
    return (
      <AppShell width="default">
        <ErrorState title="Trade not found" onRetry={() => void tradeQuery.refetch()} />
      </AppShell>
    );
  }

  const tradeWithPayout: Trade = isSeller
    ? { ...trade, payout: payoutQuery.data ?? null }
    : trade;

  return (
    <AppShell width="wide">
      <TradeRoom
        trade={tradeWithPayout}
        currentUserId={me?._id}
        currentUserPhone={me?.phone}
        socketState={socketState}
      />
    </AppShell>
  );
}
