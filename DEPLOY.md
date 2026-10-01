# Deploying StripClub — Supabase Cloud + Vercel

Step-by-step production deployment. Nothing here changes app logic —
it provisions the cloud services the app already expects.

---

## Live deployment (current)

| Thing | Value |
| --- | --- |
| Repository | https://github.com/epicnew67-oss/Zclub (`main`) |
| Production URL | **https://zclub-lime.vercel.app** |
| Vercel project | `zclub` (team `sc-lub`, owner epicnew67-oss) |
| Supabase cloud project | `sclub` — ref `vkdkvicgiopfmugsjijw` (Seoul) |
| Supabase URL | `https://vkdkvicgiopfmugsjijw.supabase.co` |
| Local env for Vercel values | `.env.production.local` (gitignored) |
| Migrations on cloud | 15/15 applied (`npx supabase db push`) |

> **Gotcha that cost us an hour:** if the Vercel project is created
> manually (`vercel project add`) its **framework preset is empty**, so
> Vercel runs `npm run build` but deploys the **source tree** as static
> files — static assets return 200 while every app route 404s with
> `X-Vercel-Error: NOT_FOUND`. Fix: set the preset to Next.js:
> ```bash
> # dashboard: Project → Settings → Build & Development → Framework Preset → Next.js
> # or via API:
> curl -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
>   -d '{"framework":"nextjs"}' \
>   "https://api.vercel.com/v9/projects/zclub?teamId=team_3jgfyQy30QfRu5GCa8G45sSC"
> ```
> then redeploy. (A plain `vercel --prod` on a fresh directory detects
> the framework automatically — this only bites when the project was
> pre-created.)

### One dashboard step still required (Auth links)
Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://zclub-lime.vercel.app`
- **Redirect URLs** (add all four):
  - `https://zclub-lime.vercel.app/auth/check-email`
  - `https://zclub-lime.vercel.app/auth/reset-password`
  - `http://localhost:3000/auth/check-email`
  - `http://localhost:3000/auth/reset-password`

Without this, email confirmation and password-reset links land on the
wrong page.

---

## 1. Supabase Cloud (database, auth, storage, realtime)

### 1.1 Create the project
1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a region close to your users, set a strong database password
   (save it in your password manager).
3. Wait for provisioning (~2 min).

### 1.2 Copy the API keys
Project → **Settings → API**:

| Dashboard value        | Env var                          |
| ---------------------- | -------------------------------- |
| Project URL            | `NEXT_PUBLIC_SUPABASE_URL`       |
| `anon` / publishable   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`  |
| `service_role` / secret| `SUPABASE_SERVICE_ROLE_KEY`      |

> The service-role key bypasses RLS. **Never** prefix it with
> `NEXT_PUBLIC_` and never expose it to the browser.

### 1.3 Push the database schema (all 16 migrations)
From the project folder, one time:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # ref is in the dashboard URL
npx supabase db push
```

This applies every migration in `supabase/migrations/` in order, which
creates: all tables + enums + indexes, RLS policies, the append-only
ledger/audit triggers, storage buckets (`listing-photos`,
`seller-avatars`, `topup-screenshots`), the RPCs (wallet, top-ups,
bookings, escrow, payouts, disputes, admin panel, notifications), the
settings rows, and the seeded token packs + categories.

Verify in the dashboard:
- **Table editor** → 20 public tables present.
- **Storage** → 3 buckets present (all private).
- **Database → Policies** → RLS enabled with policies.
- **SQL editor** → `select count(*) from token_packs;` → `5`.

### 1.4 Auth configuration
Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://<your-domain>` (e.g. the Vercel domain or
  `https://stripclubonline.com`).
- **Redirect URLs** (add all):
  - `https://<your-domain>/auth/check-email`
  - `https://<your-domain>/auth/reset-password`
  - `http://localhost:3000/auth/check-email` (dev)
  - `http://localhost:3000/auth/reset-password` (dev)

Keep **email confirmations ON** (Authentication → Providers → Email),
which is the flow the app implements (sign-up → check email → confirm).

### 1.5 Email delivery (recommended before launch)
Supabase's built-in sender is rate-limited (a few emails/hour on the
free tier). For real traffic, configure custom SMTP:
**Authentication → Emails → SMTP Settings** (Resend, Postmark, SendGrid,
or Supabase's own SMTP add-on all work).

---

## 2. GitHub (Vercel needs a Git remote)

The repo currently has no remote. One time:

```bash
git add -A
git commit -m "StripClub production build"
# create an EMPTY repo at github.com/<you>/stripclub first, then:
git remote add origin https://github.com/<you>/stripclub.git
git push -u origin master
```

> `.env.local` is gitignored — keys never leave your machine. Only
> `.env.example` is committed.

---

## 3. Vercel

### 3.1 Import
1. <https://vercel.com/new> → Import the GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Root directory: repo
   root. Build command / output: defaults.

### 3.2 Environment variables
Add these for **Production** (and Preview if you want previews to work).
Values come from steps 1.2 + your LiveKit/NOWPayments dashboards:

| Key                             | Value / notes                                        |
| ------------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase Project URL                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key                                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service-role key (**server-only**)           |
| `LIVEKIT_URL`                   | `wss://<your-project>.livekit.cloud`                  |
| `LIVEKIT_API_KEY`               | LiveKit key                                           |
| `LIVEKIT_API_SECRET`            | LiveKit secret (also verifies webhook HMACs)          |
| `NOWPAYMENTS_API_KEY`           | NOWPayments API key                                   |
| `NOWPAYMENTS_IPN_SECRET`        | NOWPayments IPN secret                                |
| `NOWPAYMENTS_BASE_URL`          | `https://api.nowpayments.io` (sandbox: `https://api-sandbox.nowpayments.io`) |
| `NEXT_PUBLIC_SITE_URL`          | `https://<your-domain>` — used for NOWPayments IPN callback + auth email redirects |
| `VAPID_PUBLIC_KEY`              | optional — `npx web-push generate-vapid-keys`         |
| `VAPID_PRIVATE_KEY`             | optional — admin push notifications                   |
| `VAPID_SUBJECT`                 | optional — `mailto:you@your-domain`                   |
| `EMAIL_WEBHOOK_URL`             | optional — enables real email delivery (Resend-shaped JSON) |

### 3.3 Deploy
Hit **Deploy**. First build takes a few minutes.

> **CSP note:** the production Content-Security-Policy is derived at
> build time from `NEXT_PUBLIC_SUPABASE_URL` and `LIVEKIT_URL`. If you
> change either env var, redeploy so the CSP is regenerated.

### 3.4 Post-deploy service configuration
- **NOWPayments** → Store settings → IPN: the app passes
  `ipn_callback_url = <NEXT_PUBLIC_SITE_URL>/api/webhooks/nowpayments`
  with every invoice, so no dashboard change is strictly required; you
  may also set it manually for redundancy.
- **LiveKit** → no origin allow-list change needed: tokens are minted
  server-side and the browser only connects to the LiveKit Cloud
  websocket (already allowed by the CSP via `LIVEKIT_URL`).

---

## 4. Smoke test after deploy (in order)

1. Open `https://<domain>` → homepage renders, counters show real
   numbers (0 on a fresh database — never NaN), hero shows the swarm
   when approved photos exist.
2. Sign up with a real email → "Check your email" page.
3. Click the confirmation link → signed in → `/account` renders.
4. Refresh the page → still signed in (cookie session).
5. Open `/auth/sign-in` while signed in → redirected to `/account`.
6. Sign out → protected routes (`/account`, `/wallet`, `/orders`)
   redirect to sign-in.
7. `/wallet` → buy a pack (JazzCash/Easypaisa manual flow or crypto
   with real NOWPayments keys) → finance approves under
   `/finance/topups`.
8. Seller: `/become-a-seller` → apply → admin approves at
   `/admin/sellers` → `/seller` studio unlocks.
9. Listing: create → submit → admin approves at `/admin/listings` →
   appears on `/browse`.

## 5. Local development (unchanged)

```bash
npx supabase start          # local stack
npm run dev                 # http://localhost:3000
npm test                    # 8 server-side suites
```
