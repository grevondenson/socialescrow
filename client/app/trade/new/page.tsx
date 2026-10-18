'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, ShieldCheck, Users } from 'lucide-react';
import { AppShell } from '../../../components/layout/AppShell';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { api } from '../../../lib/api';
import { formatKES, formatNumber } from '../../../lib/utils';
import { tradeErrorMessage } from '../../../lib/services/trade';

function NewTradeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const listingId = searchParams.get('listingId');

  const listingQuery = useQuery({
    queryKey: ['listing', listingId],
    queryFn: async () => (await api.get(`/listings/${listingId}`)).data,
    enabled: Boolean(listingId),
  });

  const initiateMutation = useMutation({
    mutationFn: async () => (await api.post('/trades', { listingId })).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      router.push(`/trade/${data._id}`);
    },
    onError: (error) => toast.error(tradeErrorMessage(error, 'The trade was not created.')),
  });

  if (!listingId) {
    return (
      <AppShell width="narrow">
        <ErrorState
          title="No account selected"
          description="Open a listing and choose “I’m interested” to start a trade."
          onRetry={() => router.push('/')}
        />
      </AppShell>
    );
  }

  if (listingQuery.isLoading) {
    return (
      <AppShell width="narrow">
        <div className="space-y-4">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (listingQuery.isError || !listingQuery.data) {
    return (
      <AppShell width="narrow">
        <ErrorState
          title="This listing did not load"
          description="It may have been removed or already sold."
          onRetry={() => void listingQuery.refetch()}
        />
      </AppShell>
    );
  }

  const listing = listingQuery.data;

  return (
    <AppShell width="narrow">
      <Link
        href={`/listing/${listing._id}`}
        className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the listing
      </Link>

      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Start this trade
      </h1>
      <p className="mt-1 text-sm leading-6 text-neutral-600">
        Check the details before you lock anything. Once funds are in escrow they can only
        move after you confirm receipt or an admin resolves a dispute.
      </p>

      <Card className="mt-5">
        <CardHeader title="Account" />

        <div className="flex items-center justify-between gap-4 border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            <Users className="h-4 w-4 text-neutral-400" aria-hidden="true" />
            {listing.platform} · {listing.niche}
          </div>
          <span className="tnum text-sm font-medium text-ink">
            {formatNumber(listing.followers)} followers
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3">
          <span className="text-sm text-neutral-600">Seller</span>
          <span className="text-sm font-medium text-ink">
            {listing.seller?.kycName || listing.seller?.fullName || '—'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3">
          <div>
            <p className="text-sm text-neutral-600">Account price</p>
            <p className="text-xs text-neutral-500">The 6% platform fee is included.</p>
          </div>
          <span className="tnum text-sm font-medium text-ink">{formatKES(listing.priceKes)}</span>
        </div>

        <div className="flex items-center justify-between gap-4 pt-3">
          <div>
            <p className="font-display text-sm font-semibold text-ink">Locked into escrow</p>
            <p className="text-xs text-neutral-500">Released to the seller only when you confirm.</p>
          </div>
          <span className="tnum font-display text-xl font-semibold text-forest-700">
            {formatKES(listing.priceKes)}
          </span>
        </div>
      </Card>

      <div className="mt-4 flex items-start gap-2.5 rounded-card border border-forest-200 bg-mint/40 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" aria-hidden="true" />
        <p className="text-sm leading-5 text-forest-700">
          You will be asked to pay with M-Pesa on the next screen. Nothing is charged until
          you enter your PIN.
        </p>
      </div>

      <Button
        size="lg"
        fullWidth
        className="mt-5"
        onClick={() => initiateMutation.mutate()}
        isPending={initiateMutation.isPending}
        pendingLabel="Opening the trade…"
      >
        <Lock className="h-4 w-4" aria-hidden="true" />
        Continue to payment
      </Button>

      <p className="mt-3 text-center text-xs text-neutral-500">
        By continuing you agree to the trade terms. The seller cannot claim the money until
        you confirm you received the account.
      </p>
    </AppShell>
  );
}

export default function NewTradePage() {
  return (
    <Suspense
      fallback={
        <AppShell width="narrow">
          <Skeleton className="h-64 w-full" />
        </AppShell>
      }
    >
      <NewTradeContent />
    </Suspense>
  );
}
