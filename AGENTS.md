<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# StripClub — project rules

**PROJECT:** Marketplace where sellers list fixed-price 1:1 video call slots and buyers purchase them with site tokens.

**STACK:** Next.js 16 (App Router) + TypeScript, Tailwind v4, shadcn/ui, Supabase (Postgres, Auth, Realtime, Storage), LiveKit, NOWPayments, GSAP.

## RULES

- 1 PKR = 2 tokens. Token packs live in the `token_packs` table.
- Money is an append-only LEDGER. Never overwrite a balance. Balance = sum of ledger.
- All money and state changes happen server-side in one DB transaction. Never trust the client.
- Webhooks: verify signatures, idempotent by external payment ID.
- Booking states: `paid → scheduled → live → completed → released`; plus `cancelled`, `seller_no_show`, `disputed`.
- Roles: `buyer`, `seller`, `support`, `finance`, `owner`. Check permissions server-side on every action.
- Every admin action writes to the append-only `audit_log`.
- Communication only inside order chat (one chat per booking). No free DMs.
- Soft delete only. Never hard-delete users, ledger, bookings, or chats.

## BRAND

- All brand values live in `src/lib/brand.ts`. Use the `<Logo />` component everywhere; never hardcode logo text or colors.
- Dark, luxurious, gold/burgundy on near-black. No explicit imagery.

## WORKFLOW

- Before coding, read `PROGRESS.md`.
- After coding, update `PROGRESS.md` with what is done, what is not, and known bugs.
- Do ONLY what the current prompt asks.
- Run the build and tests before saying done.