'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { formatKES } from '../../../lib/utils';
import React, { Suspense } from 'react';

function NewTradeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const listingId = searchParams.get('listingId');

  const { data: listing, isLoading, error } = useQuery({
    queryKey: ['listing', listingId],
    queryFn: async () => {
      const res = await api.get(`/listings/${listingId}`);
      return res.data;
    },
    enabled: !!listingId,
  });

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/trades', { listingId });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      router.push(`/trade/${data._id}`);
    },
  });

  if (isLoading) return <div className="p-8 text-center">Loading listing details...</div>;
  if (error || !listing) return <div className="p-8 text-center text-red-500">Error loading listing. Please try again.</div>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Initiate Trade</h1>
      
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-800">Trade Summary</h2>
        
        <div className="space-y-4">
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-600">Account Platform</span>
            <span className="font-medium">{listing.platform}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-600">Followers</span>
            <span className="font-medium">{listing.followers?.toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-gray-600">Niche</span>
            <span className="font-medium">{listing.niche}</span>
          </div>
        </div>

        <div className="mt-8 space-y-3 rounded-md bg-slate-50 p-4">
          <div className="flex justify-between text-slate-700">
            <span>Listing Price</span>
            <span>{formatKES(listing.priceKes)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-500 italic">
            <span>Platform Escrow Fee (6%)</span>
            <span>Included in price</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold text-slate-900">
            <span>Total to Lock</span>
            <span className="text-blue-600">{formatKES(listing.priceKes)}</span>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          <p className="text-sm text-slate-500">
            By clicking the button below, you will lock <strong>{formatKES(listing.priceKes)}</strong> in escrow. 
            The seller will be notified to submit account credentials to the vault.
          </p>
          
          <button 
            onClick={() => initiateMutation.mutate()}
            disabled={initiateMutation.isPending}
            className="w-full rounded-md bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
          >
            {initiateMutation.isPending ? 'Initiating...' : 'Lock Funds & Start Trade'}
          </button>
          
          {initiateMutation.error && (
            <p className="text-center text-sm text-red-500">
              {(initiateMutation.error as any).response?.data?.message || 'Failed to initiate trade'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewTradePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <NewTradeContent />
    </Suspense>
  );
}
