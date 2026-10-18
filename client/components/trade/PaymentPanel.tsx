'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Smartphone } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Card, CardHeader } from '../ui/Card';
import { useToast } from '../ui/Toast';
import {
  triggerStkPush,
  submitManualPayment,
  tradeErrorMessage,
  isVerifyEmailError,
  type Trade,
} from '../../lib/services/trade';
import { formatKES, formatCountdown } from '../../lib/utils';

/**
 * Buyer payment panel — the ONLY place money enters escrow.
 *
 * Two paths, in order of preference:
 *   1. STK Push: the buyer's phone rings, they enter their PIN, the Daraja webhook settles.
 *   2. Manual fallback: the buyer pays via the M-Pesa menu and submits the reference code
 *      for an admin to verify. Slower, but it keeps the trade alive when STK fails.
 *
 * The payment window is real and enforced server-side; showing the countdown turns a
 * silent auto-cancel into something the buyer can act on.
 */
export function PaymentPanel({ trade, defaultPhone }: { trade: Trade; defaultPhone?: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [reference, setReference] = useState('');
  const [showFallback, setShowFallback] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // Countdown to auto-cancel. Recomputed from the server timestamp so a reload or a
  // clock difference does not drift.
  useEffect(() => {
    if (!trade.paymentWindowExpires) {
      setRemaining(null);
      return;
    }
    const update = () => {
      const ms = new Date(trade.paymentWindowExpires as string).getTime() - Date.now();
      setRemaining(Math.max(0, ms));
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [trade.paymentWindowExpires]);

  const stkMutation = useMutation({
    mutationFn: () => triggerStkPush(trade._id, phone),
    onSuccess: () => {
      toast.success('Payment request sent. Enter your M-Pesa PIN on your phone.');
      queryClient.invalidateQueries({ queryKey: ['trade', trade._id] });
    },
    onError: (error) => {
      if (isVerifyEmailError(error)) {
        setVerifyEmail(true);
        return;
      }
      toast.error(tradeErrorMessage(error, 'The payment request did not go through.'));
    },
  });

  const manualMutation = useMutation({
    mutationFn: () => submitManualPayment(trade._id, { referenceCode: reference, phoneNumber: phone }),
    onSuccess: () => {
      setReference('');
      toast.success('Reference submitted. An admin will verify it and unlock the trade.');
      queryClient.invalidateQueries({ queryKey: ['trade', trade._id] });
    },
    onError: (error) => {
      if (isVerifyEmailError(error)) {
        setVerifyEmail(true);
        return;
      }
      toast.error(tradeErrorMessage(error, 'The reference was not submitted.'));
    },
  });

  const windowClosed = remaining !== null && remaining <= 0;
  const pendingManual = trade.manualPayment?.status === 'submitted';

  return (
    <Card>
      <CardHeader
        title="Pay into escrow"
        description={`${formatKES(trade.amountKes)} leaves your wallet and is held by the platform until you confirm receipt.`}
        action={
          remaining !== null && !windowClosed ? (
            <span className="tnum inline-flex items-center gap-1.5 rounded-full bg-ochre-50 px-2.5 py-1 text-xs font-medium text-ochre-600">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatCountdown(remaining)} left
            </span>
          ) : null
        }
      />

      {verifyEmail && (
        <div className="mb-4 rounded-control border border-ochre-200 bg-ochre-50 px-3.5 py-3 text-sm text-ochre-600">
          Confirm your email address before paying. Check your inbox for the verification
          link, then reload this page.
        </div>
      )}

      {windowClosed && (
        <div className="mb-4 rounded-control border border-clay-200 bg-clay-50 px-3.5 py-3 text-sm text-clay-600">
          The payment window has closed. This trade will be cancelled and the listing
          returned to the marketplace.
        </div>
      )}

      {pendingManual && (
        <div className="rounded-control border border-ochre-200 bg-ochre-50 px-3.5 py-3">
          <p className="text-sm font-semibold text-ochre-600">Waiting for admin verification</p>
          <p className="mt-0.5 text-xs leading-4 text-ochre-600/90">
            Reference <span className="tnum font-medium">{trade.manualPayment?.referenceCode}</span>{' '}
            was submitted. This usually takes under an hour.
          </p>
        </div>
      )}

      {!pendingManual && (
        <div className="space-y-4">
          <Field
            label="M-Pesa phone number"
            htmlFor="payment-phone"
            hint="The number that will receive the PIN prompt. It must match the name on your KYC."
            required
          >
            <Input
              id="payment-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={windowClosed}
            />
          </Field>

          <Button
            fullWidth
            size="lg"
            onClick={() => stkMutation.mutate()}
            isPending={stkMutation.isPending}
            disabled={!phone.trim() || windowClosed}
            pendingLabel="Sending request…"
          >
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            Pay {formatKES(trade.amountKes)} with M-Pesa
          </Button>

          {!showFallback ? (
            <button
              type="button"
              onClick={() => setShowFallback(true)}
              className="mx-auto block min-h-[44px] text-sm font-medium text-forest underline-offset-4 hover:underline"
            >
              The prompt did not arrive
            </button>
          ) : (
            <div className="rounded-control border border-neutral-200 bg-neutral-50 p-4">
              <h3 className="text-sm font-semibold text-ink">Pay from the M-Pesa menu</h3>
              <p className="mt-1 text-xs leading-4 text-neutral-600">
                Send {formatKES(trade.amountKes)} to the platform number using Lipa na M-Pesa,
                then enter the confirmation code from your SMS here. An admin verifies it
                and unlocks the trade.
              </p>
              <div className="mt-3">
                <Field label="M-Pesa confirmation code" htmlFor="manual-reference" required>
                  <Input
                    id="manual-reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value.toUpperCase())}
                    placeholder="e.g. SJK4X9ZQ2M"
                    autoCapitalize="characters"
                    disabled={windowClosed}
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                fullWidth
                className="mt-3"
                onClick={() => manualMutation.mutate()}
                isPending={manualMutation.isPending}
                disabled={!reference.trim() || !phone.trim() || windowClosed}
              >
                Submit for verification
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
