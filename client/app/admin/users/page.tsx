'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldOff, ShieldCheck } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Field';
import { Dialog } from '../../../components/ui/Dialog';
import { Table, THead, TBody, TR, TH, TD } from '../../../components/ui/Table';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { getApiErrorMessage } from '../../../lib/services/adminOps';
import { formatDate } from '../../../lib/utils';

interface AdminUser {
  _id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  role: string;
  isVerified?: boolean;
  isBanned?: boolean;
  banReason?: string | null;
  kycVerified?: boolean;
  sellerTier?: string;
  createdAt: string;
}

const PER_PAGE = 25;

/**
 * Users table.
 *
 * Ban and unban are the only write actions. Unban is new — it was listed as "not yet
 * built" in PROJECT_CONTEXT since Phase 1, which meant a banned user could never be
 * restored through the product.
 *
 * A ban needs a reason because it is written to the audit log and shown to the user.
 */
export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [banned, setBanned] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [banReason, setBanReason] = useState('');
  const [unbanTarget, setUnbanTarget] = useState<AdminUser | null>(null);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', { role, banned, query, page }],
    queryFn: async () => {
      const { data } = await api.get('/admin/users', {
        params: {
          role: role || undefined,
          banned: banned || undefined,
          q: query || undefined,
          page,
          per_page: PER_PAGE,
        },
      });
      return data as { data: AdminUser[]; meta: { total: number; page: number; per_page: number } };
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  const banMutation = useMutation({
    mutationFn: async () => {
      if (!banTarget) return;
      await api.patch(`/admin/users/${banTarget._id}/ban`, { banReason: banReason.trim() });
    },
    onSuccess: () => {
      toast.success(`${banTarget?.fullName ?? 'User'} is banned.`);
      setBanTarget(null);
      setBanReason('');
      invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'The ban did not apply.')),
  });

  const unbanMutation = useMutation({
    mutationFn: async () => {
      if (!unbanTarget) return;
      await api.patch(`/admin/users/${unbanTarget._id}/unban`, {
        reason: 'Unbanned from the admin console',
      });
    },
    onSuccess: () => {
      toast.success(`${unbanTarget?.fullName ?? 'User'} can sign in again.`);
      setUnbanTarget(null);
      invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'The unban did not apply.')),
  });

  const users = usersQuery.data?.data ?? [];
  const total = usersQuery.data?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Users</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every account on the platform. Bans block sign-in and API access; the audit log
          records who did it and why.
        </p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <form
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <label htmlFor="user-search" className="sr-only">
            Search by name or email
          </label>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden="true"
          />
          <Input
            id="user-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or email"
            className="pl-10"
          />
        </form>

        <div className="flex gap-2">
          <div className="flex-1 sm:w-40">
            <label htmlFor="role-filter" className="sr-only">
              Filter by role
            </label>
            <Select
              id="role-filter"
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              <option value="buyer">Buyers</option>
              <option value="seller">Sellers</option>
              <option value="admin">Admins</option>
            </Select>
          </div>
          <div className="flex-1 sm:w-40">
            <label htmlFor="banned-filter" className="sr-only">
              Filter by account state
            </label>
            <Select
              id="banned-filter"
              value={banned}
              onChange={(event) => {
                setBanned(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All accounts</option>
              <option value="false">Active only</option>
              <option value="true">Banned only</option>
            </Select>
          </div>
        </div>
      </div>

      <Card flush>
        <div className="px-5 pt-5 sm:px-6">
          <p className="tnum text-xs text-neutral-500">{total} users</p>
        </div>

        {usersQuery.isLoading ? (
          <div className="space-y-2 px-5 py-4 sm:px-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : usersQuery.isError ? (
          <div className="p-5 sm:p-6">
            <ErrorState
              title="Users did not load"
              description={getApiErrorMessage(usersQuery.error, 'The users endpoint failed.')}
              onRetry={() => void usersQuery.refetch()}
            />
          </div>
        ) : users.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState
              title="No users match"
              description="Clear the search or filters to see every account."
            />
          </div>
        ) : (
          <div className="mt-2 pb-4">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Contact</TH>
                  <TH>Role</TH>
                  <TH>KYC</TH>
                  <TH>State</TH>
                  <TH>Joined</TH>
                  <TH numeric>Action</TH>
                </TR>
              </THead>
              <TBody>
                {users.map((user) => (
                  <TR key={user._id}>
                    <TD>
                      <p className="font-medium text-ink">{user.fullName ?? '—'}</p>
                      {user.sellerTier && user.sellerTier !== 'none' && (
                        <p className="text-2xs text-neutral-500">
                          {user.sellerTier === 'top_seller' ? 'Top seller' : user.sellerTier}
                        </p>
                      )}
                    </TD>
                    <TD>
                      <p className="text-xs">{user.email ?? '—'}</p>
                      {user.phone && <p className="tnum text-2xs text-neutral-500">{user.phone}</p>}
                    </TD>
                    <TD>
                      <Badge tone={user.role === 'admin' ? 'progress' : 'neutral'}>
                        {user.role}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={user.kycVerified ? 'success' : 'neutral'} dot>
                        {user.kycVerified ? 'Verified' : 'Unverified'}
                      </Badge>
                    </TD>
                    <TD>
                      {user.isBanned ? (
                        <div>
                          <Badge tone="danger" dot>
                            Banned
                          </Badge>
                          {user.banReason && (
                            <p className="mt-0.5 max-w-[12rem] truncate text-2xs text-clay-600" title={user.banReason}>
                              {user.banReason}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge tone="success" dot>
                          Active
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <span className="tnum text-xs text-neutral-500">{formatDate(user.createdAt)}</span>
                    </TD>
                    <TD numeric>
                      {user.isBanned ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setUnbanTarget(user)}
                          aria-label={`Unban ${user.fullName ?? user.email}`}
                        >
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          Unban
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setBanTarget(user)}
                          aria-label={`Ban ${user.fullName ?? user.email}`}
                        >
                          <ShieldOff className="h-4 w-4" aria-hidden="true" />
                          Ban
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}

        {users.length > 0 && (
          <div className="px-5 pb-4 sm:px-6">
            <Pagination
              page={page}
              perPage={PER_PAGE}
              total={total}
              onPageChange={setPage}
              label="users"
            />
          </div>
        )}
      </Card>

      {/* Ban */}
      <Dialog
        open={Boolean(banTarget)}
        onClose={() => {
          setBanTarget(null);
          setBanReason('');
        }}
        title={`Ban ${banTarget?.fullName ?? 'this user'}?`}
        description="They lose access immediately and cannot sign in until an admin restores them."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setBanTarget(null);
                setBanReason('');
              }}
              disabled={banMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => banMutation.mutate()}
              isPending={banMutation.isPending}
              disabled={banReason.trim().length < 5}
            >
              Ban user
            </Button>
          </>
        }
      >
        <label htmlFor="ban-reason" className="mb-1.5 block text-sm font-medium text-ink">
          Reason <span className="text-clay">*</span>
        </label>
        <textarea
          id="ban-reason"
          rows={3}
          value={banReason}
          onChange={(event) => setBanReason(event.target.value)}
          placeholder="Repeated fraudulent listings after review"
          className="w-full rounded-control border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Stored on the account, written to the audit log, and shown to the user.
        </p>
      </Dialog>

      {/* Unban */}
      <Dialog
        open={Boolean(unbanTarget)}
        onClose={() => setUnbanTarget(null)}
        title={`Restore ${unbanTarget?.fullName ?? 'this user'}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnbanTarget(null)} disabled={unbanMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => unbanMutation.mutate()} isPending={unbanMutation.isPending}>
              Restore access
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-neutral-700">
          They will be able to sign in and trade again. Their history, trades and wallet
          balance are untouched.
        </p>
      </Dialog>
    </div>
  );
}
