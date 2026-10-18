'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { fetchListings } from '../../lib/services/listings';
import { ListingCard } from './ListingCard';
import { FilterSidebar, type ListingFilters } from './FilterSidebar';
import { Button } from '../ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../ui/States';

/**
 * Marketplace feed.
 *
 * The page is now a thin shell around this, so the route itself stays a server component
 * and the metadata/copy renders without waiting for the client bundle.
 *
 * Performance choices that matter on a 3G Android:
 *   - skeletons, not a full-screen spinner (perceived speed)
 *   - 12 per page, images lazy-loaded with a fixed aspect ratio (no layout shift)
 *   - filters debounced inside FilterSidebar; one request per settled filter set
 */
export function MarketplaceFeed() {
  const { ref: sentinelRef, inView } = useInView({ rootMargin: '400px' });
  const [filters, setFilters] = useState<ListingFilters>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // A stable identity for the filter object, so the infinite query key does not change on
  // every parent render (the old code passed a fresh `{}` each time).
  const queryKey = useMemo(
    () => ['listings', filters.platform ?? '', filters.minPrice ?? '', filters.maxPrice ?? '', filters.query ?? '', filters.sortBy ?? ''],
    [filters]
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 1 }) => fetchListings({ page: pageParam, limit: 12, ...filters }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.pages
        ? lastPage.pagination.page + 1
        : undefined,
    initialPageParam: 1,
  });

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const applyFilters = useCallback((next: ListingFilters) => {
    setFilters(next);
  }, []);

  const activeFilterCount = [
    filters.platform,
    filters.minPrice,
    filters.maxPrice,
    filters.query,
    filters.niche,
  ].filter(Boolean).length;

  const listings = data?.pages.flatMap((page) => page.listings) ?? [];
  const totalListings = data?.pages[0]?.pagination?.total;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilters((current) => ({ ...current, query: searchDraft.trim() || undefined }));
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 sm:mb-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Accounts for sale
          </h1>
          <p className="text-sm text-neutral-600 sm:text-base">
            {typeof totalListings === 'number'
              ? `${totalListings} verified listings · money held in escrow until you confirm receipt`
              : 'Money held in escrow until you confirm receipt'}
          </p>
        </div>

        <div className="flex gap-2">
          <form onSubmit={submitSearch} className="relative flex-1">
            <label htmlFor="market-search" className="sr-only">
              Search accounts
            </label>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              aria-hidden="true"
            />
            <input
              id="market-search"
              ref={searchRef}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search a niche, platform or keyword"
              className="h-12 w-full rounded-control border border-neutral-300 bg-white pl-10 pr-10 text-sm text-ink placeholder:text-neutral-400 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  setFilters((current) => ({ ...current, query: undefined }));
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-neutral-400 hover:bg-neutral-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </form>

          <Button
            variant="secondary"
            onClick={() => setSearchOpen(true)}
            className="lg:hidden"
            aria-label={`Open filters${activeFilterCount ? ` (${activeFilterCount} active)` : ''}`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {activeFilterCount > 0 && (
              <span className="tnum rounded-full bg-forest px-1.5 text-2xs text-white">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
        {/* Desktop filter column */}
        <div className="hidden lg:col-span-1 lg:block">
          <FilterSidebar onFilterChange={applyFilters} filters={filters} />
        </div>

        {/* Mobile filter sheet */}
        {searchOpen && (
          <div className="fixed inset-0 z-50 flex items-end lg:hidden">
            <div
              className="absolute inset-0 bg-ink/45 animate-fade-in"
              onClick={() => setSearchOpen(false)}
              aria-hidden="true"
            />
            <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-card bg-paper p-4 animate-fade-in">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-ink">Filters</h2>
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  aria-label="Close filters"
                  className="grid h-10 w-10 place-items-center rounded-control hover:bg-neutral-200/60"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <FilterSidebar
                onFilterChange={(next) => {
                  applyFilters(next);
                }}
                filters={filters}
              />
              <Button fullWidth className="mt-3" onClick={() => setSearchOpen(false)}>
                Show {listings.length > 0 ? `${listings.length}+ ` : ''}results
              </Button>
            </div>
          </div>
        )}

        {/* Feed */}
        <div className="lg:col-span-3">
          {isPending ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-card border border-neutral-200 bg-white">
                  <Skeleton className="aspect-[4/3] w-full rounded-none" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-6 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              title="The marketplace did not load"
              description="The listings service is not responding. Check your connection, then try again."
              onRetry={() => void refetch()}
            />
          ) : listings.length === 0 ? (
            <EmptyState
              title={activeFilterCount > 0 ? 'No accounts match those filters' : 'No accounts listed yet'}
              description={
                activeFilterCount > 0
                  ? 'Widen the price range or clear the platform filter.'
                  : 'New listings appear here once an admin reviews them. Check back shortly.'
              }
              action={
                activeFilterCount > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearchDraft('');
                      setFilters({});
                    }}
                  >
                    Clear all filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {listings.map((listing) => (
                  <ListingCard key={listing._id} listing={listing} />
                ))}
              </div>

              <div ref={sentinelRef} className="mt-10 flex h-12 items-center justify-center">
                {isFetchingNextPage && (
                  <span className="text-sm text-neutral-400">Loading more…</span>
                )}
                {!hasNextPage && (
                  <p className="text-2xs uppercase tracking-[0.14em] text-neutral-400">
                    End of listings
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export the type for pages that build filter chips.
export type { ListingFilters };
