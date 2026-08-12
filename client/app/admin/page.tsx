import Link from 'next/link';

export default function AdminRootPage() {
  return (
    <main className="space-y-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Admin Console</p>
        <h1 className="mt-4 text-4xl font-bold text-slate-900">Welcome back, administrator.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Use the admin dashboard to review KYC cases, moderate listings, and verify manual M-Pesa payments.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/overview" className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left shadow-sm transition hover:bg-slate-100">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Overview</p>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Platform health</h2>
          <p className="mt-2 text-sm text-slate-600">See high-level platform metrics and control flags.</p>
        </Link>

        <Link href="/admin/kyc" className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left shadow-sm transition hover:bg-slate-100">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">KYC</p>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Review queue</h2>
          <p className="mt-2 text-sm text-slate-600">Approve or reject pending identity checks.</p>
        </Link>

        <Link href="/admin/listings" className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left shadow-sm transition hover:bg-slate-100">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Listings</p>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Moderate listings</h2>
          <p className="mt-2 text-sm text-slate-600">Review new listings and enforce marketplace quality.</p>
        </Link>

        <Link href="/admin/payments" className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left shadow-sm transition hover:bg-slate-100">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Payments</p>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Manual payment cases</h2>
          <p className="mt-2 text-sm text-slate-600">Verify fallback M-Pesa submissions and resolve disputes.</p>
        </Link>
      </section>
    </main>
  );
}
