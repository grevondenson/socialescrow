'use client';

import WalletCard from '../../../components/dashboard/WalletCard';

export default function BuyerDashboardPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>
        Buyer Dashboard
      </h1>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <WalletCard />
      </div>
    </main>
  );
}
