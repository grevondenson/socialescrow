import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';

async function getListing(id: string) {
  try {
    const res = await fetch(`http://localhost:5000/api/listings/${id}`, {
      cache: 'no-store', // Always fetch latest state
    });
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    return null;
  }
}

export default async function ListingPage({ params }: { params: { id: string } }) {
  const listing = await getListing(params.id);

  if (!listing) {
    notFound();
  }

  const cookieStore = cookies();
  const token = cookieStore.get('refreshToken');
  const isLoggedIn = !!token;
  const actionUrl = isLoggedIn ? `/trade/new?listingId=${listing._id}` : `/login?redirect=/listing/${listing._id}`;

  return (
    <div className="min-h-screen bg-gray-50 pt-16 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-indigo-600 hover:text-indigo-800 font-medium text-sm flex items-center gap-1 mb-6">
          &larr; Back to Marketplace
        </Link>
        
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col md:flex-row">
          {/* Image Gallery */}
          <div className="md:w-1/2 bg-gray-100 min-h-[300px] relative">
             {listing.proofScreenshots?.[0] ? (
               // eslint-disable-next-line @next/next/no-img-element
               <img 
                 src={listing.proofScreenshots[0]} 
                 alt="Proof Screenshot" 
                 className="absolute inset-0 w-full h-full object-cover"
               />
             ) : (
               <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-medium">No Image Provided</div>
             )}
          </div>

          {/* Details */}
          <div className="md:w-1/2 p-8 lg:p-12">
            <div className="flex items-center gap-3 mb-4">
              <span className="bg-gray-100 text-gray-800 text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wide">
                {listing.platform}
              </span>
              <span className={`text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wide ${listing.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {listing.status.replace('_', ' ')}
              </span>
            </div>

            <h1 className="text-3xl font-black text-gray-900 mb-2">{listing.niche} Account</h1>
            
            <div className="flex items-center gap-6 mb-8 text-gray-500 font-medium">
              <div>
                <span className="text-gray-900 font-bold text-lg">{listing.followers.toLocaleString()}</span> followers
              </div>
              {listing.engagementRate && (
                <div>
                  <span className="text-gray-900 font-bold text-lg">{listing.engagementRate}</span> engagement
                </div>
              )}
            </div>

            <div className="bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-100">
               <p className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-1">Asking Price</p>
               <div className="text-4xl font-black text-indigo-600">KES {listing.priceKes.toLocaleString()}</div>
            </div>

            <div className="mb-8">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Description</h3>
              <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{listing.description || 'No description provided.'}</p>
            </div>

            <div className="mb-8 p-5 bg-indigo-50 rounded-2xl border border-indigo-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-indigo-400 uppercase tracking-wider font-bold mb-1">Seller</p>
                  <p className="font-bold text-indigo-900 text-lg">{listing.seller.kycName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-indigo-400 uppercase tracking-wider font-bold mb-1">Tier</p>
                  <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded-md font-bold uppercase">
                    {listing.seller.sellerTier.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            <Link href={actionUrl} className="block text-center w-full bg-black text-white font-bold py-4 rounded-xl hover:bg-gray-800 transition-colors shadow-lg shadow-black/10">
              I&apos;m Interested
            </Link>
            <p className="text-center text-xs text-gray-400 font-medium mt-4">
              Funds are held securely in escrow until credentials are verified.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
