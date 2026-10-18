'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X, ShieldCheck, Wallet, Store, PlusCircle, LayoutDashboard } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuthContext } from '../../lib/auth/auth-context';
import { Button } from '../ui/Button';

/**
 * Site header.
 *
 * Until now there was no navigation at all: the marketplace reserved `pt-16` for a
 * header that did not exist, and /admin had its own nine-link grid. This is the single
 * nav for the public + authenticated product; the admin console gets its own sidebar.
 *
 * Mobile: a drawer, not a crushed inline row. Every target is 44px.
 */

const NAV = [
  { href: '/', label: 'Marketplace', icon: Store },
  { href: '/seller', label: 'Sell', icon: PlusCircle, authOnly: true },
  { href: '/wallet', label: 'Wallet', icon: Wallet, authOnly: true },
  { href: '/buyer', label: 'Dashboard', icon: LayoutDashboard, authOnly: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { user, isLoading, logout } = useAuthContext();

  const links = NAV.filter((item) => !item.authOnly || user);
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-control py-1"
          aria-label="SocialEscrow home"
        >
          {/* Wordmark only — there are no brand assets in the repo yet. */}
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest text-white">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-ink">
            SocialEscrow
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              className={cn(
                'rounded-control px-3 py-2 text-sm font-medium transition-colors',
                isActive(href)
                  ? 'bg-forest-50 text-forest-700'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-ink'
              )}
            >
              {label}
            </Link>
          ))}
          {user?.role === 'admin' && (
            <Link
              href="/admin"
              className="rounded-control px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-ink"
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {isLoading ? (
            <div className="h-9 w-24 animate-pulse rounded-control bg-neutral-200" />
          ) : user ? (
            <>
              <span className="max-w-[12rem] truncate text-sm text-neutral-600">
                {user.fullName || user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Create account</Button>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="grid h-11 w-11 place-items-center rounded-control text-ink hover:bg-neutral-100 md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-neutral-200 bg-paper px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] items-center gap-3 rounded-control px-3 text-sm font-medium',
                  isActive(href) ? 'bg-forest-50 text-forest-700' : 'text-neutral-700'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
            {user?.role === 'admin' && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center gap-3 rounded-control px-3 text-sm font-medium text-neutral-700"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Admin
              </Link>
            )}
          </nav>

          <div className="mt-3 border-t border-neutral-200 pt-3">
            {user ? (
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-neutral-600">
                  {user.fullName || user.email}
                </span>
                <Button variant="secondary" size="sm" onClick={() => void logout()}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                <Link href="/login" onClick={() => setOpen(false)}>
                  <Button variant="secondary" fullWidth>
                    Sign in
                  </Button>
                </Link>
                <Link href="/register" onClick={() => setOpen(false)}>
                  <Button fullWidth>Create account</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          SocialEscrow · Funds held in M-Pesa escrow until you confirm receipt.
        </p>
        <p className="text-xs">
          Need help with a trade? Support is reachable from inside every trade room.
        </p>
      </div>
    </footer>
  );
}
