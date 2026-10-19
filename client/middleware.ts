import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Coarse edge gate.
 *
 * The access token lives in memory (see lib/auth/token-store.ts), so it is invisible to
 * middleware. The only thing we can check here is the presence of the httpOnly `refreshToken`
 * cookie — which does tell us whether a session *might* exist, but not whether it is still
 * valid. So this is a redirect-for-convenience gate, NOT the security boundary:
 *
 *   - protected route + no cookie  → bounce to /login (we know they're logged out)
 *   - /login or /register + cookie → bounce to / (they're probably already signed in)
 *
 * Real authorization is enforced server-side on every request by `protect`/`requireRole`, and
 * client-side by AuthProvider's /auth/me probe. An invalid-but-present cookie simply fails
 * those checks and lands the user back on /login.
 */
const PROTECTED_PREFIXES = ['/admin', '/wallet', '/trade', '/seller', '/buyer', '/listing/create'];
const AUTH_PAGES = ['/login', '/register'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get('refreshToken')?.value);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !hasSession) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (AUTH_PAGES.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Route groups like (auth)/(marketplace) are stripped from the URL, so they must not appear
  // here — the previous matcher listed `auth` and `marketplace`, which never matched anything.
  matcher: [
    '/admin/:path*',
    '/wallet/:path*',
    '/trade/:path*',
    '/seller/:path*',
    '/buyer/:path*',
    '/listing/create',
    '/login',
    '/register',
  ],
};
