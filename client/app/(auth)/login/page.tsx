import Link from 'next/link';
import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { AuthForm } from '../../../components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col justify-center bg-paper px-4 py-12">
      <div className="mx-auto w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-forest text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-ink">
            SocialEscrow
          </span>
        </Link>

        <div className="rounded-card border border-neutral-200 bg-white p-6 shadow-card sm:p-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Pick up where you left off — your trades and escrow balances are here.
          </p>

          <div className="mt-6">
            <AuthForm mode="login" />
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-neutral-600">
          No account yet?{' '}
          <Link href="/register" className="font-medium text-forest underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
