'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AxiosError } from 'axios';
import { useAuth } from '../../hooks/useAuth';
import type { RegisterInput } from '../../lib/auth/auth-context';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';

type Mode = 'login' | 'register';

/** Extracts the server's `{ message }` error body, falling back to a generic string. */
const errorMessage = (error: unknown, fallback: string): string => {
  const axiosError = error as AxiosError<{ message?: string }>;
  return axiosError.response?.data?.message ?? fallback;
};

/** Password rules are mirrored client-side so the user is not bounced for nothing. */
const PASSWORD_MIN = 8;

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register } = useAuth();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setFieldErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (mode === 'register' && form.fullName.trim().length < 2) {
      next.fullName = 'Enter your full name as it appears on M-Pesa.';
    }
    if (!form.email.includes('@')) next.email = 'Enter a valid email address.';
    if (form.password.length < PASSWORD_MIN) {
      next.password = `Use at least ${PASSWORD_MIN} characters.`;
    }
    if (mode === 'register' && form.password !== form.confirmPassword) {
      next.confirmPassword = 'The two passwords do not match.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        await register(form as RegisterInput);
      } else {
        await login(form.email, form.password);
      }
      // Read the `next` param the middleware set when it bounced you here.
      const next = new URLSearchParams(window.location.search).get('next');
      // Full reload (not router.push) so middleware re-reads the freshly set refresh cookie
      // and server components re-render with the new session.
      window.location.href = next && next.startsWith('/') ? next : '/';
    } catch (err) {
      setError(errorMessage(err, mode === 'register' ? 'Registration failed' : 'Sign in failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-control border border-clay-200 bg-clay-50 px-3.5 py-2.5 text-sm text-clay-600">
          {error}
        </p>
      )}

      {mode === 'register' && (
        <Field
          label="Full name"
          htmlFor="auth-fullName"
          hint="Exactly as it appears on your M-Pesa account — we check this on your first payment."
          required
          error={fieldErrors.fullName}
        >
          <Input
            id="auth-fullName"
            type="text"
            name="fullName"
            autoComplete="name"
            value={form.fullName}
            onChange={update('fullName')}
            disabled={isSubmitting}
            invalid={Boolean(fieldErrors.fullName)}
          />
        </Field>
      )}

      <Field label="Email" htmlFor="auth-email" required error={fieldErrors.email}>
        <Input
          id="auth-email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={update('email')}
          disabled={isSubmitting}
          invalid={Boolean(fieldErrors.email)}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="auth-password"
        required
        hint={mode === 'register' ? `At least ${PASSWORD_MIN} characters.` : undefined}
        error={fieldErrors.password}
      >
        <Input
          id="auth-password"
          type="password"
          name="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={form.password}
          onChange={update('password')}
          disabled={isSubmitting}
          invalid={Boolean(fieldErrors.password)}
        />
      </Field>

      {mode === 'register' && (
        <Field
          label="Confirm password"
          htmlFor="auth-confirmPassword"
          required
          error={fieldErrors.confirmPassword}
        >
          <Input
            id="auth-confirmPassword"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            disabled={isSubmitting}
            invalid={Boolean(fieldErrors.confirmPassword)}
          />
        </Field>
      )}

      <Button type="submit" size="lg" fullWidth isPending={isSubmitting} pendingLabel="Please wait…">
        {mode === 'register' ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  );
}
