'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

interface PendingManualPayment {
  _id: string;
  trade: {
    _id: string;
    status: string;
    amountKes: number;
  };
  user: {
    _id: string;
    name: string;
    email: string;
  };
  manualPayment: {
    referenceCode: string;
    status: string;
    submittedAt: string;
    notes?: string;
  };
}

export default function AdminPaymentsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<PendingManualPayment[]>({
    queryKey: ['admin', 'manualPayments'],
    queryFn: async () => {
      const res = await api.get('/mpesa/manual-payment/pending');
      return res.data;
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'verified' | 'rejected' }) => {
      const res = await api.patch(`/mpesa/manual-payment/${id}/verify`, { status });
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'manualPayments'] }),
  });

  if (isLoading) return <div className="p-8 text-center">Loading pending payments...</div>;
  if (isError) return <div className="p-8 text-center text-red-500">Failed to load pending payments.</div>;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Manual Payment Verification</h1>
          <p className="text-sm text-slate-500">Approve or reject manually uploaded M-Pesa payment receipts.</p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No manual payment cases are pending review.
        </div>
      ) : (
        <div className="space-y-6">
          {data.map((payment) => (
            <div key={payment._id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Buyer</p>
                  <p className="font-semibold text-slate-900">{payment.user.name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Trade</p>
                  <p className="font-semibold text-slate-900">{payment.trade._id}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Amount</p>
                  <p className="font-semibold text-slate-900">KES {payment.trade.amountKes.toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Reference</p>
                  <p className="font-semibold text-slate-900">{payment.manualPayment.referenceCode}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Submitted</p>
                  <p className="font-semibold text-slate-900">{new Date(payment.manualPayment.submittedAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Status</p>
                  <p className="font-semibold text-slate-900">{payment.manualPayment.status}</p>
                </div>
              </div>

              {payment.manualPayment.notes && (
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">Notes</p>
                  <p>{payment.manualPayment.notes}</p>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => verifyMutation.mutate({ id: payment._id, status: 'verified' })}
                  disabled={verifyMutation.isPending}
                  className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  Verify Payment
                </button>
                <button
                  type="button"
                  onClick={() => verifyMutation.mutate({ id: payment._id, status: 'rejected' })}
                  disabled={verifyMutation.isPending}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-300"
                >
                  Reject Payment
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
