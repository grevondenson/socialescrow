import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '../../../components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Sign in · SocialEscrow',
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-500">Welcome back to SocialEscrow.</p>
      </div>

      <AuthForm mode="login" />

      <p className="text-center text-sm text-slate-500">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-semibold text-slate-900 underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
