'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { formatKES } from '../../../lib/utils';
import React, { useState, useEffect } from 'react';

export default function TradeRoomPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [credentialsInput, setCredentialsInput] = useState('');
  
  // 1. Fetch current user
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/auth/me');
      return res.data;
    }
  });

  // 2. Fetch trade data with polling
  const { data: trade, isLoading, error } = useQuery({
    queryKey: ['trade', id],
    queryFn: async () => {
      const res = await api.get(`/trades/${id}`);
      return res.data;
    },
    refetchInterval: 5000, // 5s polling
    refetchOnWindowFocus: false,
  });

  // 3. Mutations
  const mockPaymentMutation = useMutation({
    mutationFn: () => api.patch(`/trades/${id}/mock-payment`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trade', id] })
  });

  const submitVaultMutation = useMutation({
    mutationFn: () => api.post(`/trades/${id}/vault`, { credentials: credentialsInput }),
    onSuccess: () => {
      setCredentialsInput('');
      queryClient.invalidateQueries({ queryKey: ['trade', id] });
    }
  });

  const releaseMutation = useMutation({
    mutationFn: () => api.patch(`/trades/${id}/release`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trade', id] })
  });

  const revealMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/trades/${id}/vault/reveal`);
      return res.data;
    },
    onSuccess: (data) => {
      setDecrypted(data.credentials);
      setTimer(60);
    }
  });

  // 4. Timer Logic & Cleanup
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0 && decrypted) {
      setDecrypted(null);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timer, decrypted]);

  // Mandatory memory wipe on unmount
  useEffect(() => {
    return () => {
      setDecrypted(null);
    };
  }, []);

  if (isLoading || !user) return <div className="p-8 text-center">Loading trade room...</div>;
  if (error || !trade) return <div className="p-8 text-center text-red-500">Error loading trade.</div>;

  const isBuyer = user._id?.toString() === trade.buyer?._id?.toString();
  const isSeller = user._id?.toString() === trade.seller?._id?.toString();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Trade Room</h1>
        <div className="rounded-full bg-blue-100 px-4 py-1 text-sm font-semibold text-blue-700 uppercase">
          {trade.status?.replace(/_/g, ' ')}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Info */}
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold border-b pb-2 text-slate-800">Listing Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Platform</p>
                <p className="font-medium">{trade.listing?.platform}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Niche</p>
                <p className="font-medium">{trade.listing?.niche}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Price</p>
                <p className="font-medium">{formatKES(trade.amountKes)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Platform Fee</p>
                <p className="font-medium text-slate-600">{formatKES(trade.platformFeeKes)}</p>
              </div>
            </div>
          </div>

          {/* Action Panel */}
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold border-b pb-2 text-slate-800">Actions</h2>
            
            {/* Buyer View */}
            {isBuyer && (
              <div className="space-y-4">
                {trade.status === 'payment_window' && (
                  <div>
                    <p className="mb-4 text-sm text-gray-600">Please complete the payment to proceed.</p>
                    <button 
                      onClick={() => mockPaymentMutation.mutate()}
                      disabled={mockPaymentMutation.isPending}
                      className="w-full rounded-md bg-green-600 py-2 font-bold text-white hover:bg-green-700 disabled:bg-green-300"
                    >
                      {mockPaymentMutation.isPending ? 'Processing...' : `Mock Pay (${formatKES(trade.amountKes)})`}
                    </button>
                  </div>
                )}
                
                {trade.status === 'paid' && (
                  <p className="text-center py-4 text-gray-500 italic">
                    {trade.hasVaultCredentials 
                      ? 'Seller has submitted credentials. Waiting for release...' 
                      : 'Waiting for seller to submit credentials...'}
                  </p>
                )}

                {trade.status === 'credentials_released' && !decrypted && (
                  <div>
                    <p className="mb-4 text-sm text-gray-600">Seller has released the credentials. You can now reveal them.</p>
                    <button 
                      onClick={() => revealMutation.mutate()}
                      disabled={revealMutation.isPending || trade.vaultRevealed}
                      className="w-full rounded-md bg-blue-600 py-2 font-bold text-white hover:bg-blue-700 disabled:bg-blue-300"
                    >
                      {trade.vaultRevealed ? 'Already Revealed' : (revealMutation.isPending ? 'Revealing...' : 'Reveal Credentials')}
                    </button>
                  </div>
                )}

                {decrypted && (
                  <div className="rounded-md bg-amber-50 p-4 border border-amber-200">
                    <p className="mb-2 text-xs font-bold text-amber-800 uppercase tracking-wider">Credentials (Auto-wipe in {timer}s)</p>
                    <div className="rounded bg-white p-3 font-mono text-sm break-all border border-amber-100 select-all">
                      {decrypted}
                    </div>
                  </div>
                )}

                {revealMutation.error && (
                  <p className="text-center text-sm text-red-500 mt-2">
                    {(revealMutation.error as any).response?.data?.message || 'Failed to reveal credentials'}
                  </p>
                )}
              </div>
            )}

            {/* Seller View */}
            {isSeller && (
              <div className="space-y-4">
                {trade.status === 'payment_window' && (
                  <p className="text-center py-4 text-gray-500 italic">Waiting for buyer to complete payment...</p>
                )}

                {trade.status === 'paid' && (
                  <div>
                    <p className="mb-2 text-sm text-gray-600">Enter account credentials for the buyer:</p>
                    <textarea 
                      value={credentialsInput}
                      onChange={(e) => setCredentialsInput(e.target.value)}
                      placeholder="Username: password"
                      className="w-full rounded-md border p-3 text-sm focus:ring-2 focus:ring-blue-500"
                      rows={3}
                    />
                    <button 
                      onClick={() => submitVaultMutation.mutate()}
                      disabled={!credentialsInput || submitVaultMutation.isPending}
                      className="mt-2 w-full rounded-md bg-blue-600 py-2 font-bold text-white hover:bg-blue-700 disabled:bg-gray-300"
                    >
                      {submitVaultMutation.isPending ? 'Submitting...' : 'Submit to Vault'}
                    </button>
                    
                    <button 
                      onClick={() => releaseMutation.mutate()}
                      disabled={releaseMutation.isPending}
                      className="mt-4 w-full rounded-md border-2 border-blue-600 py-2 font-bold text-blue-600 hover:bg-blue-50 disabled:border-blue-300 disabled:text-blue-300"
                    >
                      {releaseMutation.isPending ? 'Releasing...' : 'Release to Buyer'}
                    </button>
                  </div>
                )}
                
                {trade.status === 'credentials_released' && (
                  <p className="text-center py-4 text-green-600 font-medium">Credentials released to buyer.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-gray-400 uppercase tracking-widest">Parties</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Buyer</p>
                <p className="text-sm font-semibold text-slate-700">{trade.buyer?.name} {trade.buyer?._id === user._id && '(You)'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Seller</p>
                <p className="text-sm font-semibold text-slate-700">{trade.seller?.name} {trade.seller?._id === user._id && '(You)'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
