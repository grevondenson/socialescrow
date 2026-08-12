'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminListings, reviewListing, removeListing } from '../../../lib/services/admin';

export default function AdminListingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'listings'],
    queryFn: fetchAdminListings,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => reviewListing(id, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeListing(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'listings'] }),
  });

  if (isLoading) return <div className="p-8 text-center">Loading listings...</div>;
  if (isError) return <div className="p-8 text-center text-red-500">Failed to load listings.</div>;

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Listing Moderation</h1>
          <p className="text-sm text-slate-500">Review and moderate recently submitted marketplace listings.</p>
        </div>
      </div>

      <div className="space-y-6">
        {data.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            There are no listings in the admin queue.
          </div>
        ) : data.map((listing) => (
          <div key={listing._id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Seller</p>
                <p className="font-semibold text-slate-900">{listing.seller?.kycName || listing.seller?.email || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Platform</p>
                <p className="font-semibold text-slate-900">{listing.platform}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Niche</p>
                <p className="font-semibold text-slate-900">{listing.niche}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Price</p>
                <p className="font-semibold text-slate-900">KES {listing.priceKes.toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Status</p>
                <p className="font-semibold text-slate-900">{listing.status.replaceAll('_', ' ')}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">Moderation</p>
                <p className="font-semibold text-slate-900">{listing.moderationStatus.replaceAll('_', ' ')}</p>
              </div>
            </div>

            {listing.moderationNotes && (
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">Moderator Notes</p>
                <p>{listing.moderationNotes}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => reviewMutation.mutate({ id: listing._id, decision: 'approve' })}
                disabled={reviewMutation.isPending}
                className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:bg-slate-300"
              >
                Approve Listing
              </button>
              <button
                type="button"
                onClick={() => reviewMutation.mutate({ id: listing._id, decision: 'reject' })}
                disabled={reviewMutation.isPending}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-300"
              >
                Reject Listing
              </button>
              <button
                type="button"
                onClick={() => removeMutation.mutate(listing._id)}
                disabled={removeMutation.isPending}
                className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 disabled:border-slate-200 disabled:text-slate-300"
              >
                Remove Listing
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
