'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { clearAccessToken, setAccessToken } from './token-store';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  isVerified: boolean;
  role?: 'user' | 'seller' | 'admin';
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the initial /auth/refresh + /auth/me probe settles. */
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, try to restore a session. The access token lives in memory only, so after a
  // reload it is gone — but the httpOnly refresh cookie survives, so we can mint a new one.
  // No cookie / expired cookie → /auth/refresh 401s and we simply stay logged out.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        if (cancelled) return;
        setAccessToken(data.accessToken);

        const me = await api.get('/auth/me');
        if (!cancelled) setUser(me.data);
      } catch {
        if (!cancelled) {
          clearAccessToken();
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user as AuthUser;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const { data } = await api.post('/auth/register', input);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user as AuthUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Clear locally even if the server call failed — the user asked to be logged out.
      clearAccessToken();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, isAuthenticated: user !== null, login, register, logout }),
    [user, isLoading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth context. Throws if used outside <AuthProvider>. */
export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
