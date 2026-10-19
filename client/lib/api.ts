import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { clearAccessToken, getAccessToken, setAccessToken } from './auth/token-store';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // carries the httpOnly `refreshToken` cookie to /auth/refresh
});

/**
 * Endpoints that must never trigger a refresh-and-retry.
 *
 * A 401 from /auth/refresh means the refresh cookie itself is dead — retrying it loops.
 * A 401 from login/register means bad credentials — retrying just burns the rate limiter.
 */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/verify'];

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

// ── Request: attach the in-memory access token ───────────────────────────────
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response: silent refresh-and-retry on 401 ────────────────────────────────
//
// Single-flight: several queries can 401 at once (e.g. a dashboard firing 4 requests after the
// 15m access token expires). Each would otherwise POST /auth/refresh independently, and the
// losers would race on a rotated cookie — the server rotates on every refresh, so a second
// concurrent call can present an already-replaced token and fail. Sharing one in-flight promise
// collapses that burst into a single refresh.
let refreshPromise: Promise<string> | null = null;

const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh')
      .then((res) => {
        const token = res.data?.accessToken as string;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';
    const isAuthEndpoint = AUTH_ENDPOINTS.some((endpoint) => url.startsWith(endpoint));

    if (status === 401 && config && !config._retried && !isAuthEndpoint) {
      config._retried = true; // retry at most once, so a dead cookie can't loop
      try {
        const token = await refreshAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return api.request(config);
      } catch {
        clearAccessToken();
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);
