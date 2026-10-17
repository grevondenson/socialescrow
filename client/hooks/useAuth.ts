'use client';

import { useAuthContext } from '../lib/auth/auth-context';

/**
 * Auth state + actions. Thin wrapper over AuthContext so pages can keep importing `useAuth`.
 */
export function useAuth() {
  return useAuthContext();
}
