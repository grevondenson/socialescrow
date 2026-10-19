import Link from 'next/link';
import { Users, TrendingUp, BadgeCheck } from 'lucide-react';
import { formatKES, formatNumber } from '../../lib/utils';

export interface ListingCardData {
  _id: string;
  platform?: string;
  niche?: string;
  followers?: number;
  engagementRate?: string;
  priceKes?: number;
  proofScreenshots?: string[];
  seller?: {
    fullName?: string;
    kycName?: string;
    sellerTier?: string;
  };
}

/**
 * Marketplace card.
 *
 * The whole card is one link — no nested interactive elements — so it is reachable by
 * keyboard and tappable anywhere. The screenshot is lazy-loaded with a fixed 4:3 box:
 * on a 3G connection the text and price must not wait for the image.
 *
 * Seller tier is rendered only when it is not the default. Nothing currently writes
 * `sellerTier` (reputation.service is absent), so in practice this badge does not appear —
 * showing "New seller" on every card would be noise, not trust.
 */
export function ListingCard({ listing }: { listing: ListingCardData }) {
  const tier = listing.seller?.sellerTier;
  const sellerName = listing.seller?.kycName || listing.seller?.fullName;

  return (
    <Link
      href={`/listing/${listing._id}`}
      className="group block overflow-hidden rounded-card border border-neutral-200 bg-white shadow-card transition-shadow duration-200 hover:shadow-lift focus-visible:shadow-lift"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
        {listing.proofScreenshots?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.proofScreenshots[0]}
            alt={`${listing.platform ?? 'Account'} proof screenshot`}
            loading="lazy"
            decoding="async"
            width={480}
            height={360}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full place-items-center text-xs font-medium text-neutral-400">
            No screenshot
          </div>
        )}

        {listing.platform && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-2xs font-semibold text-ink shadow-sm">
            {listing.platform}
          </span>
        )}

        {tier && tier !== 'none' && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-forest px-2 py-1 text-2xs font-semibold text-white shadow-sm">
            <BadgeCheck className="h-3 w-3" aria-hidden="true" />
            {tier === 'top_seller' ? 'Top seller' : tier === 'trusted' ? 'Trusted' : 'Verified'}
          </span>
        )}
      </div>

      <div className="p-4">
        <h3 className="truncate font-display text-base font-semibold tracking-tight text-ink">
          {listing.niche ?? 'Account'}
        </h3>

        <div className="mt-2 flex items-center gap-4 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tnum font-medium text-neutral-700">
              {formatNumber(listing.followers ?? 0)}
            </span>
          </span>
          {listing.engagementRate && (
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              {listing.engagementRate}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-neutral-100 pt-3">
          <div>
            <p className="text-2xs uppercase tracking-wide text-neutral-400">Price</p>
            <p className="tnum font-display text-lg font-semibold text-forest-700">
              {formatKES(listing.priceKes)}
            </p>
          </div>
          {sellerName && (
            <div className="min-w-0 text-right">
              <p className="text-2xs uppercase tracking-wide text-neutral-400">Seller</p>
              <p className="truncate text-xs font-medium text-neutral-700">{sellerName}</p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
