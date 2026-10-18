'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Eye, ShieldCheck, TimerReset, Lock } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, Textarea } from '../ui/Field';
import { Card, CardHeader } from '../ui/Card';
import { ConfirmDialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import {
  revealCredentials,
  submitCredentials,
  releaseCredentials,
  confirmReceipt,
  tradeErrorMessage,
  type Trade,
} from '../../lib/services/trade';

const WIPE_SECONDS = 60;

/**
 * Credentials exchange — the riskiest screen in the product.
 *
 * Seller: types the account details, submits to the vault, then releases.
 * Buyer: reveals ONCE (the server enforces it with a CAS on `revealed: false`), gets a
 * 60-second window to copy them, and then confirms receipt to release the money.
 *
 * The wipe is not cosmetic: the credentials are wiped from component state on unmount
 * as well as on timeout, so navigating away or closing the tab does not leave the
 * plaintext sitting in memory.
 */
export function CredentialsPanel({
  trade,
  role,
}: {
  trade: Trade;
  role: 'buyer' | 'seller';
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['trade', trade._id] });

  // ── Seller: deposit + release ───────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: () => submitCredentials(trade._id, draft),
    onSuccess: () => {
      setDraft('');
      toast.success('Credentials are in the vault. Release them when you are ready.');
      invalidate();
    },
    onError: (error) => toast.error(tradeErrorMessage(error, 'The credentials were not saved.')),
  });

  const releaseMutation = useMutation({
    mutationFn: () => releaseCredentials(trade._id),
    onSuccess: () => {
      toast.success('Released. The buyer can now reveal the credentials once.');
      invalidate();
    },
    onError: (error) => toast.error(tradeErrorMessage(error, 'Could not release.')),
  });

  // ── Buyer: reveal ───────────────────────────────────────────────────────────
  const revealMutation = useMutation({
    mutationFn: () => revealCredentials(trade._id),
    onSuccess: (data) => {
      setSecret(data.credentials);
      setRemaining(WIPE_SECONDS);
      invalidate();
    },
    onError: (error) =>
      toast.error(
        tradeErrorMessage(error, 'Credentials could not be revealed. They may already be open.')
      ),
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmReceipt(trade._id),
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success('Receipt confirmed. The seller is being paid.');
      invalidate();
    },
    onError: (error) => toast.error(tradeErrorMessage(error, 'Confirmation failed.')),
  });

  // ── The wipe ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!secret) return;
    const interval = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(interval);
          setSecret(null);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [secret]);

  // Unmount wipe: never leave plaintext credentials in a detached component tree.
  useEffect(
    () => () => {
      setSecret(null);
    },
    []
  );

  const copy = useCallback(async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.info('Copied. Save it somewhere safe before the timer runs out.');
    } catch {
      toast.error('Copying is blocked by the browser. Select the text and copy manually.');
    }
  }, [secret, toast]);

  const progress = (remaining / WIPE_SECONDS) * 100;

  // ── Seller view ─────────────────────────────────────────────────────────────
  if (role === 'seller') {
    if (trade.status === 'paid') {
      return (
        <Card>
          <CardHeader
            title="Account credentials"
            description="The buyer has paid. Their money is in escrow — you can hand over the details safely."
          />

          {!trade.hasVaultCredentials ? (
            <>
              <Field
                label="Credentials for the buyer"
                htmlFor="credential-draft"
                hint="Username, password, recovery email — everything they need to take over the account."
                required
              >
                <Textarea
                  id="credential-draft"
                  rows={4}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={'Username: …\nPassword: …\nRecovery email: …'}
                />
              </Field>
              <Button
                fullWidth
                className="mt-3"
                onClick={() => submitMutation.mutate()}
                isPending={submitMutation.isPending}
                disabled={!draft.trim()}
              >
                Save to vault
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-control border border-forest-200 bg-mint/60 px-3.5 py-3 text-sm text-forest-700">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  Your credentials are encrypted in the vault. The buyer cannot see them
                  until you press release.
                </p>
              </div>
              <Button
                fullWidth
                size="lg"
                onClick={() => releaseMutation.mutate()}
                isPending={releaseMutation.isPending}
              >
                Release to buyer
              </Button>
              <p className="text-center text-xs text-neutral-500">
                Releasing lets the buyer view the details once. They cannot reveal them twice.
              </p>
            </div>
          )}
        </Card>
      );
    }

    if (trade.status === 'credentials_released' || trade.status === 'completed') {
      return (
        <Card>
          <CardHeader title="Account credentials" />
          <p className="text-sm text-neutral-600">
            {trade.status === 'completed'
              ? 'The trade is complete. The payout has been released to you.'
              : 'Released to the buyer. You are paid as soon as they confirm receipt.'}
          </p>
        </Card>
      );
    }

    return null;
  }

  // ── Buyer view ──────────────────────────────────────────────────────────────
  if (trade.status === 'paid') {
    return (
      <Card>
        <CardHeader title="Waiting for the seller" />
        <p className="text-sm text-neutral-600">
          Your money is held in escrow. The seller has not deposited the account details
          yet — this panel updates the moment they do.
        </p>
      </Card>
    );
  }

  if (trade.status !== 'credentials_released' && trade.status !== 'completed') return null;

  return (
    <Card>
      <CardHeader
        title="Your account credentials"
        description="You can reveal them once. Copy everything you need before the timer runs out."
      />

      {!secret && (
        <>
          {trade.vaultRevealed ? (
            <div className="rounded-control border border-neutral-200 bg-neutral-50 px-3.5 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                <Lock className="h-4 w-4" aria-hidden="true" />
                Already revealed
              </p>
              <p className="mt-1 text-xs leading-4 text-neutral-500">
                These credentials were opened once and cannot be opened again. This is a
                deliberate protection for both sides — if you did not save them, raise a
                dispute below.
              </p>
            </div>
          ) : (
            <Button
              fullWidth
              size="lg"
              onClick={() => revealMutation.mutate()}
              isPending={revealMutation.isPending}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Reveal credentials
            </Button>
          )}
        </>
      )}

      {secret && (
        <div className="animate-fade-in">
          <div className="mb-2 flex items-center justify-between">
            <p className="tnum flex items-center gap-1.5 text-xs font-semibold text-clay-600">
              <TimerReset className="h-3.5 w-3.5" aria-hidden="true" />
              Hides in {remaining}s
            </p>
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-control px-2 text-xs font-medium text-forest hover:bg-forest-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
                </>
              )}
            </button>
          </div>

          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-control border border-amber-200 bg-amber-50 p-3.5 text-sm leading-6 text-ink select-all">
            {secret}
          </pre>

          {/* The countdown is a real deadline; show it as a draining bar. */}
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-clay transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {trade.status === 'credentials_released' && (
        <div className="mt-5 border-t border-neutral-100 pt-4">
          <p className="text-sm leading-5 text-neutral-600">
            Confirming releases {trade.payout ? 'the seller’s payout' : 'the escrowed money'} to the seller.
            This cannot be undone.
          </p>
          <Button
            fullWidth
            className="mt-3"
            onClick={() => setConfirmOpen(true)}
          >
            Confirm receipt and release funds
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => confirmMutation.mutate()}
        isPending={confirmMutation.isPending}
        destructive={false}
        title="Release the money to the seller?"
        confirmLabel="Yes, release funds"
      >
        <p>
          You are confirming that you received the account and the credentials work. The
          escrowed amount is released to the seller immediately and cannot be reversed here.
        </p>
        <p className="mt-2 font-medium text-ink">
          If something is wrong, close this and raise a dispute instead.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
