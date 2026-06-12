'use client';

import { useState, useEffect } from 'react';

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X', 'Facebook', 'Snapchat'];

export default function FilterSidebar({ onFilterChange }: { onFilterChange: (filters: any) => void }) {
  const [platform, setPlatform] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [query, setQuery] = useState('');
  
  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      onFilterChange({ platform, minPrice, maxPrice, query });
    }, 400);
    return () => clearTimeout(timer);
  }, [platform, minPrice, maxPrice, query, onFilterChange]);

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm sticky top-6">
      <h2 className="text-lg font-bold text-gray-900 mb-6">Filters</h2>
      
      <div className="space-y-6">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Search</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keywords..."
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Platform</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all appearance-none"
          >
            <option value="">All Platforms</option>
            {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Price Range (KES)</label>
          <div className="flex gap-3">
            <input
              type="number"
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
            />
            <input
              type="number"
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
            />
          </div>
        </div>

        <button
          onClick={() => {
            setPlatform('');
            setMinPrice('');
            setMaxPrice('');
            setQuery('');
          }}
          className="w-full py-2.5 mt-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
}
