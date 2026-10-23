-- Trip Ledger v3 migration — run in Supabase SQL Editor
-- Adds dietary preference fields to members and dietary tags to line items

alter table members add column if not exists no_dairy  boolean default false;
alter table members add column if not exists no_gluten boolean default false;

alter table line_items add column if not exists dietary_tags jsonb default '[]';
