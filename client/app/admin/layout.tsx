'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Receipt,
  Scale,
  ShieldAlert,
  ScrollText,
  BadgeCheck,
  Store,
  Banknote,
  ArrowLeftRight,
  Users,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/Button';

/**
 * Admin console shell.
 *
 * Replaces a header card with nine look-alike pill links — which had no active state, no
 * grouping, and pushed the actual content below the fold on a laptop. A persistent
 * sidebar is the right shape for a back-office tool used for minutes at a time.
 *
 * Order follows the money: queues first (things waiting on a human), then the record.
 */
const NAV = [
  {
    group: 'Needs attention',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
      { href: '/admin/payouts', label: 'Payouts', icon: Banknote },
      { href: '/admin/disputes', label: 'Disputes', icon: Scale },
      { href: '/admin/fraud', label: 'Fraud flags', icon: ShieldAlert },
      { href: '/admin/payments', label: 'Manual payments', icon: Receipt },
      { href: '/admin/kyc', label: 'KYC review', icon: BadgeCheck },
      { href: '/admin/listings', label: 'Listings', icon: Store },
    ],
  },
  {
    group: 'Records',
    items: [
      { href: '/admin/trades', label: 'Trades', icon: ArrowLeftRight },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/audit-log', label: 'Audit log', icon: ScrollText },
    ],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const nav = (
    <nav className="space-y-6" aria-label="Admin">
      {NAV.map((section) => (
        <div key={section.group}>
          <p className="px-3 text-2xs font-semibold uppercase tracking-[0.14em] text-neutral-400">
            {section.group}
          </p>
          <ul className="mt-2 space-y-0.5">
            {section.items.map(({ href, label, icon: Icon, exact }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(href, exact) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[40px] items-center gap-2.5 rounded-control px-3 text-sm transition-colors',
                    isActive(href, exact)
                      ? 'bg-forest-50 font-medium text-forest-700'
                      : 'text-neutral-600 hover:bg-neutral-100 hover:text-ink'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-paper">
      <a href="#admin-main" className="skip-link">
        Skip to content
      </a>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-neutral-200 bg-paper px-4 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-forest text-white">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="font-display text-sm font-semibold text-ink">Admin</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Close admin menu' : 'Open admin menu'}
          className="grid h-10 w-10 place-items-center rounded-control hover:bg-neutral-100"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-b border-neutral-200 bg-white px-3 py-4 lg:hidden">{nav}</div>
      )}

      <div className="mx-auto flex max-w-[90rem] gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-8">
            <Link href="/admin" className="mb-6 flex items-center gap-2 px-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest text-white">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="font-display text-sm font-semibold leading-tight text-ink">
                  SocialEscrow
                </p>
                <p className="text-2xs text-neutral-500">Admin console</p>
              </div>
            </Link>
            {nav}
            <div className="mt-8 border-t border-neutral-200 px-3 pt-4">
              <Link href="/">
                <Button variant="ghost" size="sm" fullWidth>
                  Back to marketplace
                </Button>
              </Link>
            </div>
          </div>
        </aside>

        <div id="admin-main" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
