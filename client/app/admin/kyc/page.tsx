'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPendingKycUsers, reviewKycUser } from '../../../lib/services/admin';

export default function AdminKycPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'kyc'],
    queryFn: fetchPendingKycUsers,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, notes }: { id: string; decision: 'approve' | 'reject'; notes?: string }) => reviewKycUser(id, decision, notes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'kyc'] }),
  });

  if (isLoading) return <div className="p-8 text-center">Loading pending KYC users...</div>;
  if (isError) return <div className="p-8 text-center text-red-500">Failed to load KYC review queue.</div>;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900">KYC Review Queue</h1>
        <p className="text-sm text-slate-500">Review users flagged for verification before granting full access.</p>
      </div>

      {data.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          All caught up — no KYC cases pending review.
        </div>
      ) : (
        <div className="space-y-6">
          {data.map((user) => (
            <div key={user._id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-slate-500 uppercase tracking-wide">Full Name</p>
                  <p className="font-medium text-slate-900">{user.fullName}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 uppercase tracking-wide">Email</p>
                  <p className="font-medium text-slate-900">{user.email}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 uppercase tracking-wide">Submitted KYC Name</p>
                  <p className="font-medium text-slate-900">{user.kycName || 'N/A'}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-slate-500 uppercase tracking-wide">Submitted Phone</p>
                  <p className="font-medium text-slate-900">{user.kycPhone || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 uppercase tracking-wide">KYC Verified</p>
                  <p className="font-medium text-slate-900">{user.kycVerified ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 uppercase tracking-wide">Review Notes</p>
                  <p className="font-medium text-slate-900">{user.kycVerificationMeta?.review?.notes || 'None'}</p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">KYC Metadata</p>
                  <pre className="mt-2 overflow-x-auto text-[11px] text-slate-700">{JSON.stringify(user.kycVerificationMeta || {}, null, 2)}</pre>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => reviewMutation.mutate({ id: user._id, decision: 'approve' })}
                    disabled={reviewMutation.isPending}
                    className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:bg-slate-300"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => reviewMutation.mutate({ id: user._id, decision: 'reject', notes: 'KYC data failed review' })}
                    disabled={reviewMutation.isPending}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-300"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
