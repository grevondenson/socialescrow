'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { uploadProofScreenshots } from '../../../lib/services/listings';
import { AppShell } from '../../../components/layout/AppShell';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../../components/ui/Field';
import { useToast } from '../../../components/ui/Toast';
import { UploadCloud, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X', 'Facebook', 'Snapchat'];
const MAX_FILES = 5;

/**
 * Create a listing.
 *
 * The listing goes to `pending_review` and is invisible in the marketplace until an admin
 * approves it. The form says so up front — a seller who expects to see their listing on
 * /listings immediately will assume the upload failed.
 */
export default function CreateListingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [platform, setPlatform] = useState('');
  const [niche, setNiche] = useState('');

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, MAX_FILES);
    setPreviews(
      accepted.map((file) => ({ file, url: URL.createObjectURL(file) }))
    );
  };

  const removePreview = (index: number) => {
    setPreviews((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(event.currentTarget);
    previews.forEach(({ file }) => formData.append('proofScreenshots', file));

    try {
      const data = await uploadProofScreenshots(formData);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      toast.success('Listing submitted. An admin reviews it before it appears.');
      router.push(`/listing/${data.listing._id}`);
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          'The listing was not created. Check the fields and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell width="narrow">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Sell an account
        </h1>
        <p className="mt-1 text-sm leading-6 text-neutral-600">
          List it once, honestly. Screenshots that show real insights get approved faster
          and sell at a better price.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <p role="alert" className="rounded-control border border-clay-200 bg-clay-50 px-3.5 py-2.5 text-sm text-clay-600">
            {error}
          </p>
        )}

        <Card>
          <CardHeader title="The account" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Platform" htmlFor="platform" required>
              <Select
                id="platform"
                name="platform"
                required
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
              >
                <option value="">Select platform</option>
                {PLATFORMS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Niche" htmlFor="niche" required hint="What the audience follows you for.">
              <Input
                id="niche"
                name="niche"
                required
                value={niche}
                onChange={(event) => setNiche(event.target.value)}
                placeholder="Fitness, Tech, Food…"
              />
            </Field>

            <Field label="Followers" htmlFor="followers" required>
              <Input id="followers" name="followers" type="number" inputMode="numeric" min={0} required placeholder="0" />
            </Field>

            <Field label="Asking price (KES)" htmlFor="priceKes" required hint="The 6% platform fee is taken from this.">
              <Input id="priceKes" name="priceKes" type="number" inputMode="numeric" min={0} required placeholder="0" />
            </Field>

            <Field label="Engagement rate" htmlFor="engagementRate" hint="Optional, e.g. 4.5%">
              <Input id="engagementRate" name="engagementRate" placeholder="4.5%" />
            </Field>

            <Field label="Account age (years)" htmlFor="accountAgeYears" hint="Optional">
              <Input id="accountAgeYears" name="accountAgeYears" type="number" step="0.1" min={0} placeholder="2" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Description"
            description="Buyers want to know the history, the audience and why you are selling."
          />
          <Field label="About this account" htmlFor="description">
            <Textarea
              id="description"
              name="description"
              rows={5}
              placeholder="Started in 2021 as a recipe page, now 40k followers with a 6.2% engagement rate. No strikes, no bought followers."
            />
          </Field>
        </Card>

        <Card>
          <CardHeader
            title="Proof screenshots"
            description={`Up to ${MAX_FILES} images — insights, audience location, account health.`}
          />

          <label
            htmlFor="proofScreenshots"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-8 text-center transition-colors',
              previews.length > 0
                ? 'border-forest-200 bg-forest-50/40'
                : 'border-neutral-300 hover:border-forest-300 hover:bg-neutral-50'
            )}
          >
            <UploadCloud className="h-6 w-6 text-neutral-400" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">
              {previews.length > 0 ? 'Add or replace screenshots' : 'Choose screenshots'}
            </span>
            <span className="text-xs text-neutral-500">JPEG, PNG or WebP · max {MAX_FILES} files</span>
            <input
              id="proofScreenshots"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(event) => onFiles(event.target.files)}
            />
          </label>

          {previews.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {previews.map((preview, index) => (
                <li key={preview.url} className="relative overflow-hidden rounded-control border border-neutral-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.url}
                    alt={`Selected screenshot ${index + 1}`}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                    width={160}
                    height={160}
                  />
                  <button
                    type="button"
                    onClick={() => removePreview(index)}
                    aria-label={`Remove screenshot ${index + 1}`}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/70 text-white hover:bg-ink"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="rounded-control border border-ochre-200 bg-ochre-50 px-4 py-3 text-sm leading-5 text-ochre-600">
          Your listing goes to an admin for review before it appears in the marketplace.
          That usually takes a few hours.
        </div>

        <Button type="submit" size="lg" fullWidth isPending={loading} pendingLabel="Creating listing…">
          Submit for review
        </Button>
      </form>
    </AppShell>
  );
}
