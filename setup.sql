-- Trip Ledger v2 — run once in a NEW Supabase project (SQL Editor → New query)
-- If upgrading from v1, see the comment at the bottom.

create extension if not exists pgcrypto;

-- ── Core tables ──────────────────────────────────────────────────────────────

create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  start_date  date,
  end_date    date,
  created_at  timestamptz default now()
);

create table if not exists members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid references trips(id) on delete cascade,
  name         text not null,
  arrive_date  date,
  depart_date  date,
  diet         text default 'meat',
  drinks       boolean default true,
  meals        jsonb default '{"breakfast":true,"lunch":true,"dinner":true}'
);

create table if not exists receipts (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid references trips(id) on delete cascade,
  store      text,
  date       date,
  total      numeric,
  buyer_id   uuid,
  photo_url  text,
  kind       text default 'grocery',
  attendees  jsonb default '[]',
  created_at timestamptz default now()
);

create table if not exists line_items (
  id             uuid primary key default gen_random_uuid(),
  receipt_id     uuid references receipts(id) on delete cascade,
  name           text,
  qty            int default 1,
  price          numeric,
  category       text,
  claimed_by     uuid,
  claimed_amount numeric
);

-- ── Subscriptions ─────────────────────────────────────────────────────────────
-- status: trial | active | expired | cancelled
-- Written by the stripe-webhook Edge Function via the service-role key.

create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users(id) on delete cascade unique not null,
  status                 text not null default 'trial',
  trial_ends_at          timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan                   text,            -- monthly | yearly
  current_period_end     timestamptz,
  created_at             timestamptz default now()
);

-- Auto-create a trial row when a new user signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trial', now() + interval '2 days');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Row-level security ────────────────────────────────────────────────────────

alter table trips         enable row level security;
alter table members       enable row level security;
alter table receipts      enable row level security;
alter table line_items    enable row level security;
alter table subscriptions enable row level security;

-- Each user sees only their own trips
create policy "trips_own" on trips for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Members visible through trip ownership
create policy "members_own" on members for all
  using  (exists (select 1 from trips where trips.id = trip_id and trips.user_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = trip_id and trips.user_id = auth.uid()));

-- Receipts visible through trip ownership
create policy "receipts_own" on receipts for all
  using  (exists (select 1 from trips where trips.id = trip_id and trips.user_id = auth.uid()))
  with check (exists (select 1 from trips where trips.id = trip_id and trips.user_id = auth.uid()));

-- Line items visible through receipt → trip ownership
create policy "line_items_own" on line_items for all
  using (exists (
    select 1 from receipts r
    join trips t on t.id = r.trip_id
    where r.id = receipt_id and t.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from receipts r
    join trips t on t.id = r.trip_id
    where r.id = receipt_id and t.user_id = auth.uid()
  ));

-- Users can read their own subscription; the webhook writes via service role
create policy "sub_read_own" on subscriptions for select
  using (auth.uid() = user_id);

-- ── Realtime ──────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table trips, members, receipts, line_items;

-- ── Storage (receipt photos) ──────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
  values ('receipt-photos', 'receipt-photos', true)
  on conflict do nothing;

create policy "photos_read"  on storage.objects for select
  using (bucket_id = 'receipt-photos');
create policy "photos_write" on storage.objects for insert
  with check (bucket_id = 'receipt-photos' and auth.uid() is not null);
create policy "photos_delete" on storage.objects for delete
  using (bucket_id = 'receipt-photos' and auth.uid() is not null);

-- ── Upgrading from v1 (no-auth version) ──────────────────────────────────────
-- If you have an existing v1 database:
--   1. Run this file in full (it uses IF NOT EXISTS, so safe).
--   2. Then run:
--        alter table trips add column if not exists user_id uuid references auth.users(id);
--        drop policy if exists "open" on trips;
--        drop policy if exists "open" on members;
--        drop policy if exists "open" on receipts;
--        drop policy if exists "open" on line_items;
--        drop table if exists trip_settings;
--   3. Assign user_id on existing rows manually before enabling the new policies.
