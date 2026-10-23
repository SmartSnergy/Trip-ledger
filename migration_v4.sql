-- Trip Ledger v4 migration — run in Supabase SQL Editor
-- Adds friends list, trip sharing/invites, email on members, and shared-access RLS

-- ── 1. Email on members ───────────────────────────────────────────────────────
alter table members add column if not exists email text;

-- ── 2. Friends list ───────────────────────────────────────────────────────────
create table if not exists friends (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  email      text,
  created_at timestamptz default now()
);
alter table friends enable row level security;
create policy "friends_own" on friends for all
  using  (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ── 3. Trip invites ───────────────────────────────────────────────────────────
create table if not exists trip_invites (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid references trips(id) on delete cascade not null,
  invite_token     uuid default gen_random_uuid() not null unique,
  invited_email    text,
  invited_user_id  uuid references auth.users(id),
  role             text default 'editor',
  status           text default 'pending',
  created_at       timestamptz default now()
);
alter table trip_invites enable row level security;
-- Trip owner can manage invites for their trips
create policy "invites_owner" on trip_invites for all
  using  (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));
-- Invited user can see invites they own
create policy "invites_self_read" on trip_invites for select
  using (invited_user_id = auth.uid());

-- ── 4. RPC: accept an invite by token (security definer so any authed user can call it) ──
create or replace function accept_trip_invite(p_token uuid)
returns text language plpgsql security definer as $$
declare
  v_invite trip_invites%rowtype;
begin
  select * into v_invite from trip_invites where invite_token = p_token;
  if not found then return 'not_found'; end if;
  if v_invite.status = 'accepted' then return 'already_accepted'; end if;
  update trip_invites
     set status = 'accepted', invited_user_id = auth.uid()
   where invite_token = p_token;
  return 'ok';
end;
$$;

-- ── 5. Update trips RLS — allow invited users to read trips ──────────────────
-- Drop old combined policy and replace with separate read/write
drop policy if exists "trips_own" on trips;

create policy "trips_read" on trips for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from trip_invites ti
      where ti.trip_id = id
        and ti.invited_user_id = auth.uid()
        and ti.status = 'accepted'
    )
  );
create policy "trips_insert" on trips for insert with check (auth.uid() = user_id);
create policy "trips_update" on trips for update using (auth.uid() = user_id);
create policy "trips_delete" on trips for delete using (auth.uid() = user_id);

-- ── 6. Members RLS — allow shared users to read/write ────────────────────────
drop policy if exists "members_own" on members;

create policy "members_access" on members for all
  using (exists (
    select 1 from trips t where t.id = trip_id and (
      t.user_id = auth.uid()
      or exists (
        select 1 from trip_invites ti
        where ti.trip_id = t.id and ti.invited_user_id = auth.uid() and ti.status = 'accepted'
      )
    )
  ))
  with check (exists (
    select 1 from trips t where t.id = trip_id and (
      t.user_id = auth.uid()
      or exists (
        select 1 from trip_invites ti
        where ti.trip_id = t.id and ti.invited_user_id = auth.uid() and ti.status = 'accepted'
      )
    )
  ));

-- ── 7. Receipts RLS — allow shared users to read/write ───────────────────────
drop policy if exists "receipts_own" on receipts;

create policy "receipts_access" on receipts for all
  using (exists (
    select 1 from trips t where t.id = trip_id and (
      t.user_id = auth.uid()
      or exists (
        select 1 from trip_invites ti
        where ti.trip_id = t.id and ti.invited_user_id = auth.uid() and ti.status = 'accepted'
      )
    )
  ))
  with check (exists (
    select 1 from trips t where t.id = trip_id and (
      t.user_id = auth.uid()
      or exists (
        select 1 from trip_invites ti
        where ti.trip_id = t.id and ti.invited_user_id = auth.uid() and ti.status = 'accepted'
      )
    )
  ));

-- ── 8. Line items RLS — allow shared users to read/write ─────────────────────
drop policy if exists "line_items_own" on line_items;

create policy "line_items_access" on line_items for all
  using (exists (
    select 1 from receipts r
    join trips t on t.id = r.trip_id
    where r.id = receipt_id and (
      t.user_id = auth.uid()
      or exists (
        select 1 from trip_invites ti
        where ti.trip_id = t.id and ti.invited_user_id = auth.uid() and ti.status = 'accepted'
      )
    )
  ))
  with check (exists (
    select 1 from receipts r
    join trips t on t.id = r.trip_id
    where r.id = receipt_id and (
      t.user_id = auth.uid()
      or exists (
        select 1 from trip_invites ti
        where ti.trip_id = t.id and ti.invited_user_id = auth.uid() and ti.status = 'accepted'
      )
    )
  ));
