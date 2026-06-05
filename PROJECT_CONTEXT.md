# PROJECT_CONTEXT.md
> Updated each session. Read this at the start of every coding session.

## Current Phase
**Phase 1 — Auth + KYC**
Week 1 | Started: 8 June 2026

## What's Been Built
- [ ] Folder structure scaffolded
- [ ] Server: User model
- [ ] Server: POST /auth/register
- [ ] Server: POST /auth/login (JWT)
- [ ] Server: Role middleware
- [ ] Server: Email verification
- [ ] Client: Register page
- [ ] Client: Login page
- [ ] Client: Next.js middleware (protected routes)

## Architecture Decisions
| Decision | Choice | Reason |
|----------|--------|--------|
| Auth strategy | JWT + HTTP-only cookie | Stateless, secure, works with Next.js SSR |
| Password hashing | bcrypt (rounds: 12) | Industry standard |
| Roles | buyer / seller / admin | Three distinct permission levels |
| DB | MongoDB Atlas | Flexible schema, free tier for dev |

## Environment
- Server runs on: http://localhost:5000
- Client runs on: http://localhost:3000
- DB: MongoDB Atlas (see .env)

## Known Issues / Blockers
_none yet_

## Next Session Goals
1. Create User model with Mongoose
2. Build POST /auth/register endpoint
3. Test with Thunder Client
