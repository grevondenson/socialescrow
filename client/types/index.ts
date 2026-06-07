export interface User {
  _id: string;
  name: string;
  email: string;
  role: 'buyer' | 'seller' | 'admin';
  verified: boolean;
}

export interface Listing {
  _id: string;
  title: string;
  description: string;
  priceKES: number;
  sellerId: string;
  createdAt: string;
}

export interface Trade {
  _id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  status: string;
  createdAt: string;
}
