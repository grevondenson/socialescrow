# SocialEscrow

A fintech-grade escrow marketplace for social media account transactions.
Built as a full-stack learning project covering MERN, M-Pesa, WebSockets, encryption, and system design.

## Stack
- **Frontend**: Next.js 14, Tailwind CSS
- **Backend**: Node.js, Express
- **Database**: MongoDB + Mongoose
- **Payments**: Safaricom Daraja (M-Pesa)
- **Realtime**: Socket.io
- **Auth**: JWT + bcrypt
- **Storage**: Cloudinary

## Setup
```bash
# Server
cd server && npm install && cp .env.example .env && npm run dev

# Client
cd client && npm install && cp .env.local.example .env.local && npm run dev
```

## Architecture
See `PROJECT_CONTEXT.md` for current build state and decisions.
