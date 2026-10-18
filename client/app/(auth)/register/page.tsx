import Link from 'next/link';
import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { AuthForm } from '../../../components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Create account',
};

export default function RegisterPage() {
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
            Create your account
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Browsing is free. Confirm your email before you list or pay.
          </p>

          <div className="mt-6">
            <AuthForm mode="register" />
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-neutral-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-forest underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
