-- Campaign cards — ONE number printed on N package inserts, pooled claims, per-customer once.
-- Race-safe ledger for the dropy-rewards app proxy POST /apps/rewards/card/redeem (campaign path).
-- No Supabase migration tooling is wired into this repo (Prisma only manages Shopify Sessions),
-- so apply this by pasting it into the Supabase SQL editor. It is idempotent (safe to re-run).

-- One row per printed campaign card. Seeded lazily on first claim from the Shopify metaobject;
-- claim_count is the single source of truth for the pool (never trust the metaobject mirror).
create table if not exists campaign_cards (
  card_number   text        primary key,
  metaobject_id text        not null,
  amount        int         not null,
  max_claims    int         not null,
  claim_count   int         not null default 0,
  expires_at    timestamptz,
  status        text        not null default 'active'
);

-- One row per (card, customer). The composite PK is the per-customer-once guard: a second
-- claim by the same customer hits a 23505 unique violation before any credit is issued.
create table if not exists card_claims (
  card_number text        not null,
  customer_id text        not null,
  credit_gid  text,
  status      text        not null default 'pending',
  claimed_at  timestamptz default now(),
  primary key (card_number, customer_id)
);

-- Atomic pool increment. The single guarded UPDATE serializes under Postgres row locks, so
-- concurrent callers re-read claim_count after acquiring the lock and only one can take the
-- final slot. RETURN FOUND is true only when a row was actually updated (a slot was reserved).
create or replace function claim_campaign_slot(p_card text)
returns boolean
language plpgsql
as $$
begin
  update campaign_cards
     set claim_count = claim_count + 1
   where card_number = p_card
     and claim_count < max_claims
     and status = 'active';
  return found;
end;
$$;

-- Atomic pool release — rolls the pool back when store-credit issuance fails after a slot
-- was reserved. Guarded by claim_count > 0 so the counter can never underflow below zero.
create or replace function release_campaign_slot(p_card text)
returns boolean
language plpgsql
as $$
begin
  update campaign_cards
     set claim_count = claim_count - 1
   where card_number = p_card
     and claim_count > 0;
  return found;
end;
$$;
