import { api } from '../api';

export interface PendingKycUser {
  _id: string;
  fullName: string;
  email: string;
  kycName?: string;
  kycPhone?: string;
  kycVerified?: boolean;
  kycVerificationMeta?: Record<string, any>;
}

export interface AdminListing {
  _id: string;
  platform: string;
  niche: string;
  followers: number;
  priceKes: number;
  status: string;
  moderationStatus: string;
  moderationNotes?: string;
  seller: {
    _id: string;
    kycName?: string;
    email?: string;
  };
}

export const fetchPendingKycUsers = async () => {
  const { data } = await api.get('/admin/users/kyc-review');
  return data as PendingKycUser[];
};

export const reviewKycUser = async (id: string, decision: 'approve' | 'reject', notes?: string) => {
  const { data } = await api.patch(`/admin/users/${id}/kyc-review`, { decision, notes });
  return data;
};

export const fetchAdminListings = async () => {
  const { data } = await api.get('/admin/listings');
  return data as AdminListing[];
};

export const reviewListing = async (id: string, decision: 'approve' | 'reject', notes?: string) => {
  const { data } = await api.patch(`/admin/listings/${id}/moderation`, { decision, notes });
  return data;
};

export const removeListing = async (id: string) => {
  const { data } = await api.patch(`/admin/listings/${id}/remove`);
  return data;
};
