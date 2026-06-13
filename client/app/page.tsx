'use client';

import React, { useState, useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import { fetchListings } from '../lib/services/listings';
import ListingCard from '../components/ListingCard';
import FilterSidebar from '../components/FilterSidebar';

export default function MarketplaceFeed() {
  const { ref, inView } = useInView();
  const [filters, setFilters] = useState({});

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['listings', filters],
    queryFn: ({ pageParam = 1 }) => fetchListings({ page: pageParam, limit: 12, ...filters }),
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination.page < lastPage.pagination.pages) {
        return lastPage.pagination.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
  });

  useEffect(() => {
    if (inView && hasNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, fetchNextPage]);

  return (
    <div className="min-h-screen bg-gray-50 pt-16 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="mb-8">
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">Marketplace</h1>
          <p className="mt-2 text-lg text-gray-500 font-medium">Discover premium social media accounts.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <FilterSidebar onFilterChange={setFilters} />
          </div>

          {/* Feed */}
          <div className="lg:col-span-3">
            {status === 'pending' ? (
              <div className="flex justify-center py-32">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              </div>
            ) : status === 'error' ? (
              <div className="bg-red-50 text-red-600 p-8 rounded-2xl border border-red-100 text-center font-medium">
                Failed to load listings. Please try again.
              </div>
            ) : (
              <>
                {data.pages[0].listings.length === 0 ? (
                  <div className="bg-white p-16 rounded-2xl border border-gray-100 text-center shadow-sm">
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">No accounts found</h3>
                    <p className="text-gray-500 font-medium">Try adjusting your filters to see more results.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {data.pages.map((page, i) => (
                      <React.Fragment key={i}>
                        {page.listings.map((listing: any) => (
                          <ListingCard key={listing._id} listing={listing} />
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {/* Loading indicator for next page */}
                <div ref={ref} className="mt-12 flex justify-center h-10">
                  {isFetchingNextPage && (
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                  )}
                  {!hasNextPage && data.pages[0].listings.length > 0 && (
                    <p className="text-gray-400 font-bold text-sm uppercase tracking-wide">You&apos;ve reached the end.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
