'use client';

import Link from 'next/link';
import { ArrowLeft, Wifi, WifiOff, CircleDashed } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { StatusRail, railFromTrade } from './StatusRail';
import { PaymentPanel } from './PaymentPanel';
import { CredentialsPanel } from './CredentialsPanel';
import { ChatPanel } from './ChatPanel';
import { DisputePanel } from './DisputePanel';
import { PayoutPanel } from './PayoutPanel';
import { statusMeta, TRADE_STATUS } from '../../lib/status';
import { formatKES, formatDateTime } from '../../lib/utils';
import type { Trade } from '../../lib/services/trade';
import type { TradeSocketState } from '../../hooks/useTradeSocket';

/**
 * Trade room container.
 *
 * Replaces the previous 365-line single-file component. The page owns fetching; this
 * owns layout. Every panel is told what role it is in by props, so the buyer and seller
 * views can never drift apart into two different code paths.
 *
 * Layout: on desktop the action column (2fr) and the rail + chat column (1fr) sit side by
 * side. On mobile the rail comes FIRST — before any action — because "where am I in this
 * sequence?" is the question that stops people pressing the wrong button.
 */
export function TradeRoom({
  trade,
  currentUserId,
  currentUserPhone,
  socketState,
}: {
  trade: Trade;
  currentUserId?: string;
  currentUserPhone?: string;
  socketState: TradeSocketState;
}) {
  const isBuyer = currentUserId === trade.buyer?._id?.toString();
  const isSeller = currentUserId === trade.seller?._id?.toString();
  const role: 'buyer' | 'seller' | 'observer' =
    isBuyer ? 'buyer' : isSeller ? 'seller' : 'observer';

  const { stations, halted } = railFromTrade({
    status: trade.status,
    createdAt: trade.createdAt,
    vaultRevealedAt: trade.vaultRevealedAt,
    payout: trade.payout ?? null,
    cancelReason: trade.cancelReason,
  });

  const meta = statusMeta(TRADE_STATUS, trade.status);
  const disputed = trade.status === 'disputed';

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link
        href={role === 'seller' ? '/seller' : '/buyer'}
        className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to dashboard
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Trade room
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {trade.listing?.platform ?? 'Account'}{' '}
            <span className="text-neutral-400">·</span>{' '}
            {trade.listing?.niche ?? 'Listing'}
          </h1>
          <p className="tnum mt-1 text-sm text-neutral-500">
            Trade {trade._id.slice(-8)} · opened {formatDateTime(trade.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
          <SocketIndicator state={socketState} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Action column ────────────────────────────────────────────────── */}
        <div className="space-y-5 lg:col-span-2 lg:order-1">
          {role === 'observer' && (
            <Card>
              <p className="text-sm text-neutral-600">
                You are not a party to this trade, so there is nothing to act on.
              </p>
            </Card>
          )}

          {role === 'buyer' && trade.status === 'payment_window' && (
            <PaymentPanel trade={trade} defaultPhone={currentUserPhone} />
          )}

          {role === 'buyer' && trade.status !== 'payment_window' && (
            <CredentialsPanel trade={trade} role="buyer" />
          )}

          {role === 'seller' && (
            <>
              {trade.status === 'payment_window' && (
                <Card>
                  <CardHeader title="Waiting for payment" />
                  <p className="text-sm leading-5 text-neutral-600">
                    The buyer is paying {formatKES(trade.amountKes)} into escrow. You will be
                    notified here, and in the chat, the moment the money is locked.
                  </p>
                </Card>
              )}
              <CredentialsPanel trade={trade} role="seller" />
            </>
          )}

          {/* Payout state: seller always once paid; buyer never needs it. */}
          {role === 'seller' &&
            ['credentials_released', 'completed', 'disputed'].includes(trade.status) && (
              <PayoutPanel payout={trade.payout} amountKes={trade.sellerPayoutKes ?? trade.amountKes} />
            )}

          {halted && role !== 'observer' && disputed && (
            <div className="rounded-card border border-clay-200 bg-clay-50 px-4 py-3.5">
              <p className="text-sm font-semibold text-clay-600">Funds are frozen</p>
              <p className="mt-1 text-sm leading-5 text-clay-600/90">
                Neither side can move this money while the dispute is open. The chat below
                stays open and an admin can read it.
              </p>
            </div>
          )}

          {role !== 'observer' && <DisputePanel trade={trade} />}

          {/* The breakdown sits last: it answers "what am I actually paying for?" after
              the actions have made sense of it. */}
          <TradeSummary trade={trade} />
        </div>

        {/* ── Rail + chat column ───────────────────────────────────────────── */}
        <div className="space-y-5 lg:col-span-1 lg:order-2">
          <Card>
            <CardHeader title="Escrow progress" />
            <StatusRail stations={stations} halted={halted} />
          </Card>

          <ChatPanel
            tradeId={trade._id}
            currentUserId={currentUserId}
            // Disputes freeze money, not conversation — the admin needs the record.
            disabled={false}
          />
        </div>
      </div>
    </div>
  );
}

function SocketIndicator({ state }: { state: TradeSocketState }) {
  if (state === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs text-neutral-400" title="Live updates on">
        <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
        Live
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs text-neutral-400">
        <CircleDashed className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Connecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-ochre" title="Falling back to periodic refresh">
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      Refreshing
    </span>
  );
}

function TradeSummary({ trade }: { trade: Trade }) {
  const rows = [
    { label: 'Account price', value: formatKES(trade.amountKes) },
    { label: 'Platform fee (6%)', value: formatKES(trade.platformFeeKes) },
    { label: 'Seller receives', value: formatKES(trade.sellerPayoutKes) },
  ];

  return (
    <Card>
      <CardHeader title="What this trade covers" />
      <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-2xs uppercase tracking-wide text-neutral-400">Buyer</p>
          <p className="mt-0.5 font-medium text-ink">{trade.buyer?.fullName ?? '—'}</p>
        </div>
        <div>
          <p className="text-2xs uppercase tracking-wide text-neutral-400">Seller</p>
          <p className="mt-0.5 font-medium text-ink">{trade.seller?.fullName ?? '—'}</p>
        </div>
        {trade.listing?.followers != null && (
          <div>
            <p className="text-2xs uppercase tracking-wide text-neutral-400">Followers</p>
            <p className="tnum mt-0.5 font-medium text-ink">
              {new Intl.NumberFormat('en-KE').format(trade.listing.followers)}
            </p>
          </div>
        )}
        {trade.listing?.engagementRate && (
          <div>
            <p className="text-2xs uppercase tracking-wide text-neutral-400">Engagement</p>
            <p className="mt-0.5 font-medium text-ink">{trade.listing.engagementRate}</p>
          </div>
        )}
      </div>

      <dl className="divide-y divide-neutral-100 border-t border-neutral-100 pt-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between py-2 text-sm">
            <dt className="text-neutral-600">{row.label}</dt>
            <dd className={`tnum ${row.label.startsWith('Seller') ? 'font-semibold text-forest-700' : 'text-ink'}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
