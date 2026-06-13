import Link from 'next/link';

export default function ListingCard({ listing }: { listing: any }) {
  return (
    <Link href={`/listing/${listing._id}`} className="group block overflow-hidden rounded-2xl bg-white shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 border border-gray-100">
      <div className="aspect-[4/3] w-full overflow-hidden bg-gray-50 relative">
        {listing.proofScreenshots?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img 
            src={listing.proofScreenshots[0]} 
            alt={`${listing.platform} account`} 
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-300 text-sm font-medium">No Image</div>
        )}
        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm text-gray-900 text-xs px-2.5 py-1 rounded-full font-semibold shadow-sm">
          {listing.platform}
        </div>
        {listing.seller?.sellerTier === 'verified' && (
          <div className="absolute top-3 right-3 bg-blue-500 text-white text-[10px] px-2 py-1 rounded-full font-bold shadow-sm uppercase tracking-wide">
            Verified
          </div>
        )}
      </div>
      <div className="p-5">
        <h3 className="text-xl font-extrabold text-gray-900 line-clamp-1 tracking-tight">{listing.niche}</h3>
        <div className="mt-1.5 flex items-center gap-2 text-sm text-gray-500 font-medium">
          <span className="text-gray-900 font-bold">{listing.followers?.toLocaleString() || 0}</span> followers
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-0.5">Price</p>
            <span className="text-xl font-black text-indigo-600">KES {listing.priceKes?.toLocaleString() || 0}</span>
          </div>
          <div className="text-right">
             <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-0.5">Seller</p>
             <span className="text-sm font-semibold text-gray-700">{listing.seller?.kycName || 'Anonymous'}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
