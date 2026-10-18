'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Banknote,
  Scale,
  ShieldAlert,
  BadgeCheck,
  Store,
  Receipt,
  Activity,
  Power,
  ArrowRight,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { getApiErrorMessage } from '../../lib/services/adminOps';
import { formatKES, formatDateTime } from '../../lib/utils';

interface AdminStats {
  pendingPayouts: number;
  openDisputes: number;
  openFraudFlags: number;
  pendingKyc: number;
  pendingListings: number;
  pendingManualPayments: number;
  tradesLast7Days: number;
}

interface PlatformAccount {
  payoutsEnabled?: boolean;
  escrowPoolKes?: number;
  platformRevenueKes?: number;
  circuitBreakerTriggeredAt?: string | null;
  circuitBreakerReason?: string | null;
  updatedAt?: string;
}

/**
 * Admin overview.
 *
 * Two jobs: show the operator what is waiting on them, and show the state of the single
 * control that can stop all payouts. Everything here is a count or a flag — the overview
 * deliberately carries no charts, because there is no historical time-series endpoint to
 * chart, and a fake sparkline would be worse than a number.
 */
export default function AdminOverviewPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [breakerOpen, setBreakerOpen] = useState(false);

  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => (await api.get('/admin/stats')).data.data as AdminStats,
    refetchInterval: 30_000,
  });

  const platformQuery = useQuery({
    queryKey: ['admin', 'platform'],
    queryFn: async () => (await api.get('/admin/platform')).data as PlatformAccount,
    // 404 is a legitimate "not created yet" answer, not a failure to retry forever.
    retry: false,
  });

  const breakerMutation = useMutation({
    mutationFn: async (action: 'trigger' | 'clear') => {
      const { data } = await api.patch('/admin/platform/circuit-breaker', {
        action,
        reason: action === 'trigger' ? 'Disabled from the admin overview' : undefined,
      });
      return data;
    },
    onSuccess: (_, action) => {
      setBreakerOpen(false);
      toast.success(action === 'trigger' ? 'Payouts are disabled.' : 'Payouts are enabled.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'platform'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (error) =>
      toast.error(getApiErrorMessage(error, 'The payout switch did not change.')),
  });

  const platform = platformQuery.data;
  const payoutsEnabled = platform?.payoutsEnabled !== false;
  const stats = statsQuery.data;

  const queues = [
    { label: 'Payouts awaiting approval', value: stats?.pendingPayouts, href: '/admin/payouts', icon: Banknote, tone: 'ochre' as const },
    { label: 'Open disputes', value: stats?.openDisputes, href: '/admin/disputes', icon: Scale, tone: 'clay' as const },
    { label: 'Unresolved fraud flags', value: stats?.openFraudFlags, href: '/admin/fraud', icon: ShieldAlert, tone: 'clay' as const },
    { label: 'Manual payments to verify', value: stats?.pendingManualPayments, href: '/admin/payments', icon: Receipt, tone: 'ochre' as const },
    { label: 'KYC reviews', value: stats?.pendingKyc, href: '/admin/kyc', icon: BadgeCheck, tone: 'ochre' as const },
    { label: 'Listings to moderate', value: stats?.pendingListings, href: '/admin/listings', icon: Store, tone: 'ochre' as const },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Overview
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Everything waiting on a human decision, and the payout kill switch.
        </p>
      </header>

      {/* Circuit breaker first: it is the one control that changes the system's behaviour. */}
      {platformQuery.isError ? (
        <Card>
          <CardHeader title="Platform account" />
          <p className="text-sm text-neutral-600">
            The platform account has not been created yet. It is created automatically on the
            first escrow lock.
          </p>
        </Card>
      ) : platformQuery.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <Card
          className={
            payoutsEnabled ? undefined : 'border-clay-300 bg-clay-50/40'
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                  payoutsEnabled ? 'bg-forest-50 text-forest' : 'bg-clay-100 text-clay'
                }`}
              >
                <Power className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-semibold text-ink">Payouts</h2>
                  <Badge tone={payoutsEnabled ? 'success' : 'danger'} dot>
                    {payoutsEnabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p className="mt-1 max-w-prose text-sm leading-5 text-neutral-600">
                  {payoutsEnabled
                    ? 'Escrow release and B2C disbursement are running. Disabling this stops every payout immediately — use it if reconciliation or the fraud engine reports a problem.'
                    : `Payouts were stopped ${
                        platform?.circuitBreakerTriggeredAt
                          ? `on ${formatDateTime(platform.circuitBreakerTriggeredAt)}`
                          : 'manually'
                      }.${platform?.circuitBreakerReason ? ` Reason: ${platform.circuitBreakerReason}` : ''}`}
                </p>
              </div>
            </div>

            <Button
              variant={payoutsEnabled ? 'destructive' : 'primary'}
              onClick={() => setBreakerOpen(true)}
              isPending={breakerMutation.isPending}
              className="shrink-0"
            >
              {payoutsEnabled ? 'Disable payouts' : 'Enable payouts'}
            </Button>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-neutral-200/70 pt-4 sm:grid-cols-2">
            <div>
              <dt className="text-2xs uppercase tracking-wide text-neutral-500">Escrow pool</dt>
              <dd className="tnum mt-0.5 font-display text-lg font-semibold text-ink">
                {formatKES(platform?.escrowPoolKes ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-neutral-500">Platform revenue</dt>
              <dd className="tnum mt-0.5 font-display text-lg font-semibold text-ink">
                {formatKES(platform?.platformRevenueKes ?? 0)}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* Queues */}
      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-ink">Queues</h2>
        {statsQuery.isError ? (
          <ErrorState
            title="Counts did not load"
            onRetry={() => void statsQuery.refetch()}
          />
        ) : statsQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {queues.map((queue) => (
              <Link key={queue.href} href={queue.href} className="group block">
                <div className="flex h-full items-start justify-between rounded-card border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-lift">
                  <div>
                    <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-neutral-500">
                      <queue.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {queue.label}
                    </p>
                    <p className="tnum mt-1.5 font-display text-2xl font-semibold text-ink">
                      {queue.value ?? 0}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-forest"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Activity — honest about what is not tracked yet */}
      <Card>
        <CardHeader
          title="System health"
          description="Live state of the services this console depends on."
        />
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />
          <div className="space-y-2 text-sm text-neutral-600">
            <p>
              <span className="tnum font-medium text-ink">{stats?.tradesLast7Days ?? 0}</span>{' '}
              trades opened in the last 7 days.
            </p>
            <p className="text-xs leading-4 text-neutral-500">
              Queue worker and Redis health are reported by the server at <code>/health</code>.
              The payout worker degrades safely: with Redis unavailable, approvals stay
              at <strong>approved</strong> and are picked up by the startup sweep once
              the queue is reachable.
            </p>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={breakerOpen}
        onClose={() => setBreakerOpen(false)}
        onConfirm={() => breakerMutation.mutate(payoutsEnabled ? 'trigger' : 'clear')}
        isPending={breakerMutation.isPending}
        destructive={payoutsEnabled}
        title={payoutsEnabled ? 'Disable all payouts?' : 'Enable payouts?'}
        confirmLabel={payoutsEnabled ? 'Disable payouts' : 'Enable payouts'}
      >
        {payoutsEnabled ? (
          <p>
            Escrow release and every B2C disbursement will fail with a 503 until this is
            re-enabled. Trades already in <strong>processing</strong> at Daraja will still
            settle by callback. Use this only when money movement must stop.
          </p>
        ) : (
          <p>
            Payouts will resume. Pending approvals become actionable and the worker will
            start sending queued disbursements.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
