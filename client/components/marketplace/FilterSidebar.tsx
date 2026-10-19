'use client';

import { useEffect, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';

export interface ListingFilters {
  query?: string;
  platform?: string;
  niche?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: string;
}

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X', 'Facebook', 'Snapchat'];
const NICHES = ['Fashion', 'Tech', 'Food', 'Travel', 'Fitness', 'Music', 'Comedy', 'Business'];
const SORTS = [
  { value: '', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'followers', label: 'Most followers' },
];

const TEXT_DEBOUNCE_MS = 400;

/**
 * Filter panel.
 *
 * Controlled by the parent (`filters`) rather than holding its own truth, which is what
 * caused the previous version's churn: it kept local state AND pushed an object up on
 * every render, so the effect re-ran continuously and the debounce never settled.
 *
 * Only free-text is debounced. A platform or sort change should feel instant.
 */
export function FilterSidebar({
  onFilterChange,
  filters,
}: {
  onFilterChange: (filters: ListingFilters) => void;
  filters: ListingFilters;
}) {
  const ids = {
    niche: useId(),
    platform: useId(),
    min: useId(),
    max: useId(),
    sort: useId(),
  };

  // Local mirror for the two price inputs so partial typing ("1", "12", "120") does not
  // fire three requests. Everything else writes straight through.
  const [minDraft, setMinDraft] = useState(filters.minPrice?.toString() ?? '');
  const [maxDraft, setMaxDraft] = useState(filters.maxPrice?.toString() ?? '');

  useEffect(() => {
    setMinDraft(filters.minPrice?.toString() ?? '');
    setMaxDraft(filters.maxPrice?.toString() ?? '');
  }, [filters.minPrice, filters.maxPrice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const min = minDraft === '' ? undefined : Number(minDraft);
      const max = maxDraft === '' ? undefined : Number(maxDraft);
      const nextMin = Number.isFinite(min) ? min : undefined;
      const nextMax = Number.isFinite(max) ? max : undefined;
      if (nextMin !== filters.minPrice || nextMax !== filters.maxPrice) {
        onFilterChange({ ...filters, minPrice: nextMin, maxPrice: nextMax });
      }
    }, TEXT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `filters` is intentionally excluded: including it re-arms the timer on every
    // change the effect itself caused, which is the bug this component replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDraft, maxDraft]);

  const reset = () => {
    setMinDraft('');
    setMaxDraft('');
    onFilterChange({});
  };

  const hasFilters =
    !!filters.platform || !!filters.niche || !!filters.minPrice || !!filters.maxPrice || !!filters.sortBy;

  return (
    <div className="rounded-card border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-ink">Filters</h2>
        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[32px] items-center gap-1 rounded text-xs font-medium text-neutral-500 hover:text-ink"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
        )}
      </div>

      <div className="space-y-4">
        <Field label="Platform" htmlFor={ids.platform}>
          <Select
            id={ids.platform}
            value={filters.platform ?? ''}
            onChange={(event) =>
              onFilterChange({ ...filters, platform: event.target.value || undefined })
            }
          >
            <option value="">All platforms</option>
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Niche" htmlFor={ids.niche}>
          <Select
            id={ids.niche}
            value={filters.niche ?? ''}
            onChange={(event) =>
              onFilterChange({ ...filters, niche: event.target.value || undefined })
            }
          >
            <option value="">Any niche</option>
            {NICHES.map((niche) => (
              <option key={niche} value={niche}>
                {niche}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-ink">Price range (KES)</legend>
          <div className="flex items-center gap-2">
            <label htmlFor={ids.min} className="sr-only">
              Minimum price in KES
            </label>
            <Input
              id={ids.min}
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Min"
              value={minDraft}
              onChange={(event) => setMinDraft(event.target.value)}
            />
            <span className="text-neutral-400">–</span>
            <label htmlFor={ids.max} className="sr-only">
              Maximum price in KES
            </label>
            <Input
              id={ids.max}
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Max"
              value={maxDraft}
              onChange={(event) => setMaxDraft(event.target.value)}
            />
          </div>
        </fieldset>

        <Field label="Sort by" htmlFor={ids.sort}>
          <Select
            id={ids.sort}
            value={filters.sortBy ?? ''}
            onChange={(event) =>
              onFilterChange({ ...filters, sortBy: event.target.value || undefined })
            }
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </Select>
        </Field>

        {hasFilters && (
          <Button variant="secondary" fullWidth onClick={reset} className="lg:hidden">
            Reset filters
          </Button>
        )}
      </div>
    </div>
  );
}
