/**
 * In-memory access-token store.
 *
 * The access token is deliberately NOT persisted to localStorage/sessionStorage: the server
 * issues a short-lived (15m) access token in the response body and keeps the long-lived
 * refresh token in an httpOnly cookie, so the only place the access token needs to live is
 * memory. Persisting it would expose it to any XSS on the page for no benefit.
 *
 * The cost of that choice: a full page reload loses the token. `AuthProvider` compensates by
 * calling /auth/refresh on mount (the httpOnly cookie rides along automatically).
 *
 * Kept as a module singleton (not React state) so the axios interceptors — which run outside
 * the React tree — can read the current token synchronously.
 */

let accessToken: string | null = null;

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const clearAccessToken = (): void => {
  accessToken = null;
};
