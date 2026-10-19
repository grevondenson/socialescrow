'use client';

import { Check, Lock, ShieldAlert } from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';

/**
 * The escrow status rail — the one visual device that carries this product's identity.
 *
 * Five stations, always all present, never reordered. A buyer should be able to read this
 * column alone and know exactly whose turn it is and what happens next. That is the whole
 * job: escrow is a sequence, so the UI shows a sequence.
 *
 *   Locked   funds left the buyer's wallet
 *   Paid     funds are held by the platform
 *   Credentials  seller deposited the account details
 *   Revealed     buyer opened them (one time only)
 *   Released     money moved to the seller
 *
 * Terminal states (cancelled, disputed) do not invent new stations — they mark the rail as
 * halted at the station it reached.
 */

export type RailStation = {
  key: string;
  label: string;
  /** What happens here, in the user's words. */
  hint: string;
  timestamp?: string | null;
  actor?: string | null;
};

export type RailState = 'done' | 'current' | 'upcoming' | 'halted';

export function StatusRail({
  stations,
  halted,
}: {
  stations: Array<RailStation & { state: RailState }>;
  /** Shown once under the rail when a dispute or cancellation froze the sequence. */
  halted?: { label: string; detail: string } | null;
}) {
  return (
    <div>
      <ol className="relative space-y-0" aria-label="Escrow progress">
        {stations.map((station, index) => {
          const isLast = index === stations.length - 1;
          const done = station.state === 'done';
          const current = station.state === 'current';
          const haltedHere = station.state === 'halted';

          return (
            <li key={station.key} className="relative flex gap-3 pb-5 last:pb-0">
              {/* Connector to the next station — only drawn when this one is reached. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px',
                    done ? 'bg-forest-300' : 'bg-neutral-200'
                  )}
                />
              )}

              <span
                aria-hidden="true"
                className={cn(
                  'relative z-10 mt-0.5 grid h-[27px] w-[27px] shrink-0 place-items-center rounded-full border-2 transition-colors duration-200',
                  done && 'border-forest bg-forest text-white',
                  current && 'border-forest bg-white text-forest',
                  haltedHere && 'border-clay bg-clay text-white',
                  station.state === 'upcoming' && 'border-neutral-200 bg-white text-neutral-300'
                )}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : haltedHere ? (
                  <ShieldAlert className="h-3.5 w-3.5" />
                ) : current ? (
                  <span className="h-2 w-2 rounded-full bg-forest animate-pulse" />
                ) : (
                  <Lock className="h-3 w-3" />
                )}
              </span>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p
                    className={cn(
                      'font-display text-sm',
                      current || done || haltedHere
                        ? 'font-semibold text-ink'
                        : 'font-medium text-neutral-400'
                    )}
                  >
                    {station.label}
                  </p>
                  {station.timestamp && (
                    <p className="tnum text-2xs text-neutral-400">
                      {formatDateTime(station.timestamp)}
                    </p>
                  )}
                </div>
                <p
                  className={cn(
                    'mt-0.5 text-xs leading-4',
                    current ? 'text-neutral-600' : 'text-neutral-400'
                  )}
                >
                  {station.hint}
                  {station.actor && (
                    <span className="text-neutral-500"> · {station.actor}</span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {halted && (
        <div className="mt-4 rounded-control border border-clay-200 bg-clay-50 px-3.5 py-3">
          <p className="text-sm font-semibold text-clay-600">{halted.label}</p>
          <p className="mt-0.5 text-xs leading-4 text-clay-600/90">{halted.detail}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Derives rail station states from a Trade document.
 *
 * Kept beside the component (rather than in lib/status.ts) because it is about this
 * specific visual sequence, not the domain vocabulary. `disputed` and `cancelled` both
 * halt the rail at the last station actually reached.
 */
export function railFromTrade(trade: {
  status: string;
  createdAt?: string | null;
  vaultRevealedAt?: string | null;
  payout?: { queuedAt?: string | null; sentAt?: string | null; status?: string } | null;
  cancelReason?: string | null;
}): {
  stations: Array<RailStation & { state: RailState }>;
  halted: { label: string; detail: string } | null;
} {
  const s = trade.status;

  // How far the sequence actually got, regardless of where it stopped.
  const reached = {
    locked: ['paid', 'credentials_released', 'completed', 'disputed'].includes(s),
    credentials: ['credentials_released', 'completed', 'disputed'].includes(s),
    released: s === 'completed',
  };

  const stations: Array<RailStation & { state: RailState }> = [
    {
      key: 'locked',
      label: 'Funds locked',
      hint: 'The buyer paid and the money left their wallet.',
      timestamp: reached.locked ? trade.createdAt : null,
      actor: null,
      state: reached.locked ? 'done' : s === 'payment_window' || s === 'pending' ? 'current' : 'upcoming',
    },
    {
      key: 'credentials',
      label: 'Credentials deposited',
      hint: 'The seller placed the account details in the vault.',
      timestamp: null,
      actor: null,
      state: reached.credentials ? 'done' : reached.locked ? 'current' : 'upcoming',
    },
    {
      key: 'revealed',
      label: 'Revealed once',
      hint: 'The buyer opened the credentials. This cannot be repeated.',
      timestamp: trade.vaultRevealedAt ?? null,
      actor: trade.vaultRevealedAt ? 'Buyer' : null,
      state: s === 'completed'
        ? 'done'
        : reached.credentials && !reached.released
          ? 'current'
          : 'upcoming',
    },
    {
      key: 'released',
      label: 'Money released',
      hint: 'The buyer confirmed receipt; the payout is on its way to the seller.',
      timestamp: trade.payout?.sentAt ?? trade.payout?.queuedAt ?? null,
      actor: trade.payout?.sentAt ? 'M-Pesa' : null,
      state: reached.released ? 'done' : 'upcoming',
    },
  ];

  // If the sequence halted, mark the station it halted at instead of showing a fake "current".
  let halted: { label: string; detail: string } | null = null;

  if (s === 'disputed') {
    halted = {
      label: 'Frozen for dispute',
      detail:
        'Funds stay where they are until an admin reviews the case. You can keep talking in the chat below.',
    };
    const firstUpcoming = stations.find((station) => station.state !== 'done');
    if (firstUpcoming) firstUpcoming.state = 'halted';
  }

  if (s === 'cancelled') {
    halted = {
      label: 'Trade cancelled',
      detail: trade.cancelReason
        ? `Reason: ${trade.cancelReason}`
        : 'The payment window closed without a payment. The listing is available again.',
    };
    stations.forEach((station) => {
      if (station.state === 'current') station.state = 'halted';
    });
  }

  return { stations, halted };
}
