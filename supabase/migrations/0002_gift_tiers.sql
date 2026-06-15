-- Multi-tier cumulative free gifts — seed the loyalty_config "gift_tiers" row.
-- No Supabase migration runner is wired into this repo, so apply this by pasting it into the
-- Supabase SQL editor. It is idempotent: ON CONFLICT DO NOTHING means it never clobbers a
-- gift_tiers row you've already edited in the admin, and re-running is safe.
--
-- Tier 1 is seeded FROM the existing legacy keys (gift_threshold_paise + gift_products) so it
-- is byte-for-byte the gift that is already live. Tier 2 adds The Ordinary at ₹3,999. The legacy
-- keys are intentionally left in place as a fallback (proxy.gift.config.tsx synthesizes tier 1
-- from them if gift_tiers is ever missing), so a half-deploy never blanks the gift.

insert into loyalty_config (key, value)
select
  'gift_tiers',
  jsonb_build_array(
    jsonb_build_object(
      'threshold_paise', coalesce((select value::int from loyalty_config where key = 'gift_threshold_paise'), 249900),
      'handles', coalesce(
        (select jsonb_agg(elem ->> 'handle')
           from loyalty_config lc, lateral jsonb_array_elements(lc.value::jsonb) elem
          where lc.key = 'gift_products'),
        '[]'::jsonb
      ),
      'label', 'CeraVe travel-size'
    ),
    jsonb_build_object(
      'threshold_paise', 399900,
      'handles', jsonb_build_array('the-ordinary-squalane-cleanser-hydrating-makeup-remover-50ml-3'),
      'label', 'The Ordinary Squalane Cleanser'
    )
  )::text
on conflict (key) do nothing;
