'use client';

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { SiteHeader, SiteFooter } from './SiteHeader';

/**
 * Page shell for the public + authenticated product.
 *
 * Width is a prop rather than a per-page `mx-auto max-w-*` string: the marketplace is
 * wide, the trade room is narrow, and the site should not re-decide that on every file.
 */
export function AppShell({
  children,
  width = 'default',
  className,
}: {
  children: ReactNode;
  width?: 'narrow' | 'default' | 'wide';
  className?: string;
}) {
  const widthClass = {
    narrow: 'max-w-3xl',
    default: 'max-w-6xl',
    wide: 'max-w-7xl',
  }[width];

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className={cn('mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-10', widthClass, className)}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
