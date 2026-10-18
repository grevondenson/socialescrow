'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Textarea } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { raiseTradeDispute, tradeErrorMessage, type Trade } from '../../lib/services/trade';

/**
 * Raise a dispute.
 *
 * A dispute freezes the escrow (server-side, inside one transaction) so nobody can move
 * the money until an admin resolves it. That is a heavy action, so it is behind a dialog
 * that requires a written reason — which also becomes the admin's first piece of evidence.
 *
 * Hidden entirely once the trade is disputed: there is exactly one open dispute per trade,
 * and the server answers a second one with 409.
 */
export function DisputePanel({ trade }: { trade: Trade }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const canDispute = trade.status === 'paid' || trade.status === 'credentials_released';

  const mutation = useMutation({
    mutationFn: () => raiseTradeDispute(trade._id, reason.trim()),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      toast.success('Dispute opened. The money is frozen until an admin decides.');
      queryClient.invalidateQueries({ queryKey: ['trade', trade._id] });
    },
    onError: (error) => {
      toast.error(tradeErrorMessage(error, 'The dispute was not opened.'));
    },
  });

  if (!canDispute) return null;

  return (
    <>
      <div className="flex flex-col gap-2 rounded-card border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">Something wrong with this trade?</p>
            <p className="text-xs leading-4 text-neutral-500">
              Opening a dispute freezes the money for both sides while an admin reviews it.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="shrink-0">
          Raise a dispute
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Raise a dispute"
        description="An admin will review the chat and any evidence before deciding what happens to the money."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => mutation.mutate()}
              isPending={mutation.isPending}
              disabled={reason.trim().length < 10}
            >
              Open dispute
            </Button>
          </>
        }
      >
        <Field
          label="What went wrong?"
          htmlFor="dispute-reason"
          hint="Be specific — this is the first thing the admin reads. Minimum 10 characters."
          required
          error={
            reason.trim().length > 0 && reason.trim().length < 10
              ? 'Add a little more detail.'
              : undefined
          }
        >
          <Textarea
            id="dispute-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="The password does not work and the seller has not replied since Monday."
            invalid={reason.trim().length > 0 && reason.trim().length < 10}
          />
        </Field>
      </Dialog>
    </>
  );
}
