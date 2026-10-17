import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '../../../components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Create account · SocialEscrow',
};

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Create your account</h1>
        <p className="mt-2 text-sm text-slate-500">
          You&apos;ll need to verify your email before you can trade.
        </p>
      </div>

      <AuthForm mode="register" />

      <p className="text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-slate-900 underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
