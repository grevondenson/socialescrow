'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createListing } from '@/lib/services/listings';

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X', 'Facebook', 'Snapchat'];

export default function CreateListingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);

    try {
      const data = await createListing(formData);
      router.push(`/listing/${data.listing._id}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create listing');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-16 pb-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Sell an Account</h1>
          <p className="mt-2 text-gray-500 font-medium">List your social media account securely.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
          
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium border border-red-100">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Platform *</label>
              <select name="platform" required className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select Platform</option>
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Niche *</label>
              <input type="text" name="niche" required placeholder="e.g., Fitness, Tech" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Followers *</label>
              <input type="number" name="followers" required placeholder="0" min="0" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Asking Price (KES) *</label>
              <input type="number" name="priceKes" required placeholder="0" min="0" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Engagement Rate</label>
              <input type="text" name="engagementRate" placeholder="e.g., 4.5%" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Account Age (Years)</label>
              <input type="number" name="accountAgeYears" placeholder="e.g., 2" step="0.1" min="0" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Description</label>
            <textarea name="description" rows={4} placeholder="Tell buyers about the account's history and audience..." className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Proof Screenshots</label>
            <input type="file" name="proofScreenshots" multiple accept="image/jpeg,image/png,image/webp" className="w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
            <p className="text-xs text-gray-400 mt-2 font-medium">Upload up to 5 images (JPEG, PNG, WebP) showing insights.</p>
          </div>

          <div className="pt-4">
            <button type="submit" disabled={loading} className="w-full bg-black text-white font-bold py-4 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 shadow-lg shadow-black/10">
              {loading ? 'Creating Listing...' : 'Publish Listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
