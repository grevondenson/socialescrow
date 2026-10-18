import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { ArrowLeft, Users, TrendingUp, BadgeCheck, ShieldCheck, Lock, Eye, CheckCircle2 } from 'lucide-react';
import { AppShell } from '../../../components/layout/AppShell';
import { Badge } from '../../../components/ui/Badge';
import { statusMeta, LISTING_STATUS } from '../../../lib/status';
import { formatKES, formatNumber } from '../../../lib/utils';

interface Listing {
  _id: string;
  platform: string;
  niche: string;
  followers: number;
  engagementRate?: string;
  priceKes: number;
  description?: string;
  proofScreenshots?: string[];
  status: string;
  seller: {
    _id: string;
    kycName?: string;
    fullName?: string;
    sellerTier?: string;
    kycVerified?: boolean;
  };
}

async function getListing(id: string): Promise<Listing | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    const res = await fetch(`${apiUrl}/listings/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const listing = await getListing(params.id);
  if (!listing) return { title: 'Listing not found' };
  const price = formatKES(listing.priceKes);
  return {
    title: `${listing.niche} ${listing.platform} account — ${price}`,
    description: `${formatNumber(listing.followers)} followers. Buy safely with M-Pesa escrow.`,
  };
}

/**
 * Listing detail — a server component.
 *
 * Session detection reads the same `refreshToken` cookie the middleware uses. The previous
 * version hand-decoded the JWT payload to guess expiry; that was both redundant (the
 * cookie's presence is exactly what middleware checks) and fragile (any change to the
 * token format silently logged everyone out of the CTA).
 */
export default async function ListingPage({ params }: { params: { id: string } }) {
  const [listing, isLoggedIn] = await Promise.all([
    getListing(params.id),
    Promise.resolve(Boolean(cookies().get('refreshToken')?.value)),
  ]);

  if (!listing) notFound();

  const tier = listing.seller?.sellerTier;
  const sellerName = listing.seller?.kycName || listing.seller?.fullName || 'Seller';
  const status = statusMeta(LISTING_STATUS, listing.status);
  const actionHref = isLoggedIn
    ? `/trade/new?listingId=${listing._id}`
    : `/login?redirect=/listing/${listing._id}`;

  const escrowSteps = [
    { icon: Lock, title: 'Money locked', copy: 'Your payment is held by the platform, not the seller.' },
    { icon: Eye, title: 'Details revealed once', copy: 'You see the credentials one time, for 60 seconds.' },
    { icon: CheckCircle2, title: 'You confirm, we release', copy: 'The seller is paid only after you confirm receipt.' },
  ];

  return (
    <AppShell width="default">
      <Link
        href="/"
        className="mb-5 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to marketplace
      </Link>

      <div className="overflow-hidden rounded-card border border-neutral-200 bg-white shadow-card md:flex">
        {/* Screenshot */}
        <div className="relative aspect-[4/3] w-full bg-neutral-100 md:aspect-auto md:w-1/2">
          {listing.proofScreenshots?.[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.proofScreenshots[0]}
              alt={`${listing.platform} account proof screenshot`}
              className="absolute inset-0 h-full w-full object-cover"
              width={800}
              height={600}
            />
          ) : (
            <div className="grid h-full min-h-[16rem] place-items-center text-sm text-neutral-400">
              No screenshot provided
            </div>
          )}
        </div>

        {/* Details */}
        <div className="w-full p-5 sm:p-8 md:w-1/2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{listing.platform}</Badge>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {listing.seller?.kycVerified && (
              <Badge tone="success">
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                KYC verified
              </Badge>
            )}
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {listing.niche} account
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-neutral-600">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-neutral-400" aria-hidden="true" />
              <span className="tnum font-semibold text-ink">{formatNumber(listing.followers)}</span>
              followers
            </span>
            {listing.engagementRate && (
              <span className="inline-flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-neutral-400" aria-hidden="true" />
                <span className="font-semibold text-ink">{listing.engagementRate}</span>
                engagement
              </span>
            )}
          </div>

          <div className="mt-5 rounded-control border border-neutral-200 bg-neutral-50 px-4 py-3.5">
            <p className="text-2xs uppercase tracking-[0.12em] text-neutral-500">Asking price</p>
            <p className="tnum mt-0.5 font-display text-3xl font-semibold text-ink">
              {formatKES(listing.priceKes)}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              The 6% platform fee is included. You are charged nothing else.
            </p>
          </div>

          <Link
            href={actionHref}
            className="mt-4 grid h-12 min-h-[44px] place-items-center rounded-control bg-forest text-sm font-semibold text-white transition-colors hover:bg-forest-800"
          >
            I&apos;m interested
          </Link>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-neutral-500">
            <ShieldCheck className="h-3.5 w-3.5 text-forest" aria-hidden="true" />
            Funds are held in escrow until you confirm receipt.
          </p>
        </div>
      </div>

      {/* Description + seller, below the fold on mobile */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-card border border-neutral-200 bg-white p-5 md:col-span-2">
          <h2 className="font-display text-sm font-semibold text-ink">About this account</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
            {listing.description || 'The seller has not added a description.'}
          </p>
        </div>

        <div className="rounded-card border border-neutral-200 bg-white p-5">
          <h2 className="font-display text-sm font-semibold text-ink">Seller</h2>
          <p className="mt-2 text-base font-medium text-ink">{sellerName}</p>
          {tier && tier !== 'none' && (
            <Badge
              tone={tier === 'top_seller' ? 'success' : tier === 'trusted' ? 'progress' : 'success'}
              className="mt-2"
            >
              {tier === 'top_seller' ? 'Top seller' : tier === 'trusted' ? 'Trusted seller' : 'Verified seller'}
            </Badge>
          )}
          <p className="mt-3 text-xs leading-4 text-neutral-500">
            Seller ratings and trade counts start appearing once this seller has completed
            trades on the platform.
          </p>
        </div>
      </div>

      {/* How escrow works — the trust argument, only after the price */}
      <section className="mt-6 rounded-card border border-forest-200 bg-mint/40 p-5 sm:p-6">
        <h2 className="font-display text-sm font-semibold text-forest-700">
          What happens when you buy
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {escrowSteps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-forest text-white">
                <step.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-forest-700">
                  {index + 1}. {step.title}
                </p>
                <p className="mt-0.5 text-xs leading-4 text-forest-700/80">{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  );
}
