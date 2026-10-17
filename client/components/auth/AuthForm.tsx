'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { useAuth } from '../../hooks/useAuth';
import type { RegisterInput } from '../../lib/auth/auth-context';

type Mode = 'login' | 'register';

interface AuthFormProps {
  mode: Mode;
}

const inputClass =
  'w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50';

/** Extracts the server's `{ message }` error body, falling back to a generic string. */
const errorMessage = (error: unknown, fallback: string): string => {
  const axiosError = error as AxiosError<{ message?: string }>;
  return axiosError.response?.data?.message ?? fallback;
};

export function AuthForm({ mode }: AuthFormProps) {
  const { login, register } = useAuth();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'register') {
        // Client-side mirror of the server's rule, so the user isn't bounced for nothing.
        if (form.password !== form.confirmPassword) {
          setError('Passwords do not match');
          return;
        }
        await register(form as RegisterInput);
      } else {
        await login(form.email, form.password);
      }
      // Full reload (not router.push) so middleware re-reads the freshly set refresh cookie
      // and the server components re-render with the new session.
      window.location.href = '/';
    } catch (err) {
      setError(errorMessage(err, mode === 'register' ? 'Registration failed' : 'Login failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4">
      {mode === 'register' && (
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Full name</span>
          <input
            className={inputClass}
            type="text"
            name="fullName"
            autoComplete="name"
            required
            value={form.fullName}
            onChange={update('fullName')}
            disabled={isSubmitting}
          />
        </label>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input
          className={inputClass}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update('email')}
          disabled={isSubmitting}
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input
          className={inputClass}
          type="password"
          name="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
          value={form.password}
          onChange={update('password')}
          disabled={isSubmitting}
        />
      </label>

      {mode === 'register' && (
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Confirm password</span>
          <input
            className={inputClass}
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            disabled={isSubmitting}
          />
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:bg-slate-300"
      >
        {isSubmitting ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}
