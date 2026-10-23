-- Trip Ledger v5 migration — run in Supabase SQL Editor
-- Adds multi-payer support: payers jsonb stores [{member_id, amount}] per receipt

alter table receipts add column if not exists payers jsonb;
