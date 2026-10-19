'use client';

import { Banknote, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { statusMeta, PAYOUT_STATUS } from '../../lib/status';
import { formatKES, formatDateTime } from '../../lib/utils';
import type { TradePayout } from '../../lib/services/trade';

/**
 * Seller payout state inside the trade room — the last genuinely unfinished piece of
 * Phase 7's UI debt.
 *
 * With AUTO_PAYOUT=false (the current default) the sequence is:
 *   pending_approval -> approved -> processing -> sent | failed
 * Each step is a human or a Daraja callback, so the seller deserves to see which one
 * they are waiting on. "Failed" is explicitly not the end: the seller is still owed the
 * money, so the copy says so rather than implying the cash is gone.
 */
export function PayoutPanel({ payout, amountKes }: { payout?: TradePayout | null; amountKes: number }) {
  if (!payout) {
    return (
      <Card>
        <CardHeader title="Your payout" />
        <p className="text-sm leading-5 text-neutral-600">
          {formatKES(amountKes)} is waiting for you. It is released to your payout balance the
          moment the buyer confirms receipt.
        </p>
      </Card>
    );
  }

  const meta = statusMeta(PAYOUT_STATUS, payout.status);
  const Icon =
    payout.status === 'sent'
      ? CheckCircle2
      : payout.status === 'failed'
        ? AlertTriangle
        : Clock3;

  const iconTone =
    payout.status === 'sent'
      ? 'text-forest'
      : payout.status === 'failed'
        ? 'text-clay'
        : 'text-ochre';

  const copy: Record<string, string> = {
    pending_approval:
      'An admin is reviewing this payout before it is sent. This is the fraud check, and it protects you too.',
    approved: 'Approved. The disbursement is queued with M-Pesa.',
    processing: 'M-Pesa is sending the money to your phone. This usually takes under a minute.',
    sent: 'Paid. The money is on your M-Pesa statement.',
    failed:
      'The payout did not go through. Your money is still owed to you — an admin will re-check it against M-Pesa before trying again.',
    cancelled:
      'The payout was cancelled before it was sent. Your balance still shows the amount as owed.',
  };

  return (
    <Card>
      <CardHeader
        title="Your payout"
        action={<Badge tone={meta.tone} dot>{meta.label}</Badge>}
      />

      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="tnum font-display text-xl font-semibold text-ink">
            {formatKES(payout.amountKes ?? amountKes)}
          </p>
          <p className="mt-1 text-sm leading-5 text-neutral-600">{copy[payout.status]}</p>

          <dl className="mt-3 space-y-1 text-xs text-neutral-500">
            {payout.queuedAt && (
              <div className="flex gap-2">
                <dt>Queued</dt>
                <dd className="tnum">{formatDateTime(payout.queuedAt)}</dd>
              </div>
            )}
            {payout.approvedAt && (
              <div className="flex gap-2">
                <dt>Approved</dt>
                <dd className="tnum">{formatDateTime(payout.approvedAt)}</dd>
              </div>
            )}
            {payout.sentAt && (
              <div className="flex gap-2">
                <dt>Sent</dt>
                <dd className="tnum">{formatDateTime(payout.sentAt)}</dd>
              </div>
            )}
          </dl>

          {payout.lastError && payout.status === 'failed' && (
            <p className="mt-2 rounded-control bg-clay-50 px-2.5 py-1.5 text-xs text-clay-600">
              {payout.lastError}
            </p>
          )}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-3 text-2xs text-neutral-400">
        <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
        Paid out via M-Pesa B2C to the number on your KYC.
      </p>
    </Card>
  );
}
