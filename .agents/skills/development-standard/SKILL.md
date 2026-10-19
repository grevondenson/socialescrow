name: development-standard
description: "Master governance file for all Claude Code development behavior. This is the highest-priority standard — it overrides coding-standards when they conflict. Read this file at the start of every project. Covers project-level rules, workflow, tooling decisions, and environment setup specific to this codebase."
---
 
# CLAUDE.md — Elvis Ayilo's Development Standards
# grevondenson | Full-Stack MERN | African Markets | Vibe Coding
 
This file governs all Claude Code behavior in this project.
Read this file at the start of every session.
 
---
 
## Session Protocol
 
**At session start:**
1. Check if `PROJECT_CONTEXT.md` exists → read it fully
2. Confirm what we're working on today
3. State your approach before writing any code
**At session end (or on request):**
- Update `PROJECT_CONTEXT.md` with what was done + next steps
---
 
## The Four Principles (Karpathy-Inspired)
 
### 1. Think Before Coding
- State what you're building before starting
- Ask rather than assume on ambiguous requirements
- Name tradeoffs when multiple approaches exist
- Push back if a simpler path exists
### 2. Simplicity First
- Minimum code that solves the problem
- No speculative abstractions
- No features beyond what was asked
- If 50 lines work, don't write 200
### 3. Surgical Changes
- Touch only what the task requires
- Don't improve adjacent code unless asked
- Match existing code style
- Mention unrelated issues — don't fix them
### 4. Goal-Driven Execution
- Define what "done" looks like before starting
- Build in small verifiable steps
- Confirm each step works before moving to the next
---
 
## Tech Stack Conventions
 
**Frontend:** React (Vite) + Tailwind CSS + shadcn/ui + Lucide React + React Router v6
**Backend:** Node.js + Express + MongoDB (Mongoose) + JWT auth
**Database:** MongoDB Atlas preferred
**Payments:** M-Pesa Daraja API + Flutterwave fallback
**Hosting:** Vercel (client) + Railway (server)
 
---
 
## Code Rules
 
- ES Modules always (`import/export` — no `require`)
- `async/await` always (no `.then()` chains)
- API responses always: `{ success: true/false, data/message }`
- Controllers always: `try { ... } catch (error) { next(error) }`
- Components: functional + named exports
- Tailwind only (no inline styles, no CSS modules)
- Lucide React icons only (no emoji as icons)
- `loading="lazy"` on all images
- 44px+ touch targets on all interactive elements
---
 
## Naming Conventions
 
| Thing | Convention | Example |
|---|---|---|
| React component | PascalCase | `ProductCard.jsx` |
| API route | kebab-case | `/api/user-orders` |
| DB model | singular PascalCase | `Order` |
| Hook | `use` + camelCase | `useCart` |
| Util function | camelCase | `formatCurrency` |
| env var | SCREAMING_SNAKE_CASE | `JWT_SECRET` |
| Git branch | kebab-case | `feat/add-cart` |
 
---
 
## African Market Defaults
 
- Mobile-first (375px → 768px → 1280px)
- Light mode default
- KES/NGN/GHS currency formatting via `Intl.NumberFormat`
- Phone fields: country code selector
- WhatsApp as support channel (not just email)
- Offline-resilient API design (idempotent where possible)
---
 
## Never Do These
 
- Never commit `.env` (only `.env.example`)
- Never store passwords in plain text
- Never expose API keys client-side
- Never `console.log` in production
- Never write logic in route files (controllers only)
- Never use placeholder-only form labels
- Never autoplay media
- Never push directly to `main`
---
 
## Active Skills
 
This project uses the following skills (in `.claude/skills/`):
 
| Skill | Trigger |
|---|---|
| `session-context` | Session start/end, context restore |
| `mern-elvis` | Any backend / API / database work |
| `ui-african-market` | Any frontend / UI / component work |
| `freelance-scaffold` | New client projects, scoping, pricing |
| `vibe-coding-rules` | Always active (meta-skill) |