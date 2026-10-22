# Trip Ledger

Track shared expenses on any trip — groceries, restaurant tabs, and custom splits. Auto-calculates who owes who at the end. Each user has their own private trips with a 2-day free trial, then €2/month or €20/year.

## Features

- **User accounts** — sign up, log in, each person's trips are private to them
- **2-day free trial** — no card required to start; trial countdown banner in the app
- **Subscriptions** — €2/month or €20/year via Stripe; self-service cancellation via Stripe Customer Portal
- **Multiple trips** — create a new trip for each holiday, weekend away, or event
- **Receipts** — grocery (itemised with categories) and restaurant (split by who attended)
- **Members** — per-person dietary preferences, drink preferences, meals, and stay dates
- **Settlement** — auto-calculated debt simplification (minimum number of transfers)
- **Real-time sync** — changes sync live across devices via Supabase
- **Receipt photos** — attach a photo to any receipt; stored in Supabase Storage

---

## Full setup guide

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a free project. Note your **Project URL** and **anon/public key** from **Project Settings → API**.

### 2. Run the database schema

In your Supabase dashboard: **SQL Editor → New query**, paste the contents of `setup.sql`, and run it. This creates all tables, RLS policies, the trial auto-creation trigger, and the storage bucket.

### 3. Set up Stripe

1. Create a [Stripe](https://stripe.com) account (free to start)
2. Go to **Products → Payment Links**
3. Create two Payment Links:
   - Monthly: €2.00/month recurring
   - Annual: €20.00/year recurring
4. For each link, copy its URL (starts with `https://buy.stripe.com/…`)
5. Paste them into `index.html` at the top of the `<script>` block:
   ```js
   const STRIPE_MONTHLY_LINK = "https://buy.stripe.com/…";
   const STRIPE_YEARLY_LINK  = "https://buy.stripe.com/…";
   ```

### 4. Deploy the Edge Functions

You need two Supabase Edge Functions: one for handling Stripe webhooks, one for opening the Stripe Customer Portal.

Install the Supabase CLI if you haven't:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy both functions:
```bash
supabase functions deploy stripe-webhook
supabase functions deploy create-portal-session
```

Set the required secrets:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_…
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
```

(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

### 5. Register the Stripe webhook

1. In Stripe: **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`
3. Events to listen to:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. Copy the **Signing secret** (`whsec_…`) and set it:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
   ```

### 6. Configure the Stripe Customer Portal

In Stripe: **Settings → Customer Portal** → enable it and configure cancellation options.

### 7. Deploy to GitHub Pages

1. Create a new GitHub repository
2. Push these files to the repo:
   - `index.html`
   - `setup.sql`
   - `README.md`
   - `supabase/functions/stripe-webhook/index.ts`
   - `supabase/functions/create-portal-session/index.ts`
3. Go to **Settings → Pages** → set source to **Deploy from a branch → main → / (root)**
4. Your app will be live at `https://<your-username>.github.io/<repo-name>`

### 8. (Optional) Hardcode credentials

If you want to skip the connection screen for your own deployment, set these at the top of `index.html`:

```js
const DEFAULT_SUPABASE_URL = "https://abcxyz.supabase.co";
const DEFAULT_SUPABASE_KEY = "eyJhbGciOi…";
```

Leave them as `""` and users enter their own Supabase project (useful if you want to open-source the project for others to self-host).

---

## How subscriptions work

1. User signs up → Postgres trigger auto-creates a `subscriptions` row with `status = 'trial'` and `trial_ends_at = now() + 2 days`
2. After trial ends → app redirects to paywall screen
3. User clicks a plan → redirected to Stripe Payment Link with `?client_reference_id=USER_ID` appended
4. Stripe webhook fires → Edge Function upserts the `subscriptions` row with `status = 'active'`
5. User clicks "Refresh status" on the paywall → app re-fetches and routes them in
6. To cancel/manage → user clicks "Manage subscription" in the top-right menu → Stripe Customer Portal

---

## Local development

Just open `index.html` in any browser — no build step or server needed. Enter your Supabase credentials on the config screen; they're saved in `localStorage` so you only do it once per browser.

For Edge Functions locally:
```bash
supabase start
supabase functions serve
```
