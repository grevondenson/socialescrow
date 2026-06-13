import { api } from '../api';

export interface ListingParams {
  page?: number;
  limit?: number;
  query?: string;
  platform?: string;
  niche?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: string;
}

export const fetchListings = async (params: ListingParams) => {
  const { data } = await api.get('/api/listings', { params });
  return data;
};

export const fetchListingById = async (id: string) => {
  const { data } = await api.get(`/api/listings/${id}`);
  return data;
};

export const createListing = async (formData: FormData) => {
  const { data } = await api.post('/api/listings', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};
