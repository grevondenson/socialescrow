'use client';

import Link from 'next/link';
import { useWallet } from '../../lib/services/wallet';
import { formatKES } from '../../lib/utils';
import styles from './WalletCard.module.css';

export default function WalletCard() {
  const { data: wallet, isLoading, isError } = useWallet();

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <p className={styles.title}>My Wallet</p>
        {!isLoading && wallet && (
          <span className={styles.refreshIndicator}>Auto-refreshes every 30s</span>
        )}
      </div>

      {isError && (
        <p className={styles.errorText}>Failed to load wallet.</p>
      )}

      {isLoading && (
        <div className={styles.balanceList}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.balanceRow}>
              <span className={`${styles.skeleton}`} style={{ width: 100, height: 16 }} />
              <span className={`${styles.skeleton}`} style={{ width: 80, height: 16 }} />
            </div>
          ))}
        </div>
      )}

      {wallet && (
        <>
          <div className={styles.balanceList}>
            <div className={styles.balanceRow}>
              <span className={styles.balanceLabel}>
                <span className={`${styles.dot} ${styles.available}`} />
                Available
              </span>
              <span className={styles.balanceAmount}>
                {formatKES(wallet.availableBalance)}
              </span>
            </div>

            <div className={styles.balanceRow}>
              <span className={styles.balanceLabel}>
                <span className={`${styles.dot} ${styles.escrow}`} />
                In Escrow
              </span>
              <span className={styles.balanceAmount}>
                {formatKES(wallet.lockedInEscrow)}
              </span>
            </div>

            <div className={styles.balanceRow}>
              <span className={styles.balanceLabel}>
                <span className={`${styles.dot} ${styles.payout}`} />
                Pending Payout
              </span>
              <span className={styles.balanceAmount}>
                {formatKES(wallet.pendingPayout)}
              </span>
            </div>
          </div>

          <div className={styles.divider} />
        </>
      )}

      <Link href="/wallet" className={styles.viewLink}>
        View Transaction History →
      </Link>
    </div>
  );
}
