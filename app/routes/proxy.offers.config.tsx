import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// GET /apps/rewards/offers/config — storefront reads master offer values
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "offers_config")
    .maybeSingle();

  let cfg: any = {};
  if (data?.value) {
    try { cfg = JSON.parse(data.value); } catch (e) { cfg = {}; }
  }

  const out = {
    discount_code: cfg.discount_code || "FIRST200",
    discount_amount: Number(cfg.discount_amount) || 200,
    discount_minimum: Number(cfg.discount_minimum) || 1999,
    free_shipping_threshold: Number(cfg.free_shipping_threshold) || 1499,
    gift_tier1_threshold: Number(cfg.gift_tier1_threshold) || 2499,
    gift_tier1_name: cfg.gift_tier1_name || "",
    gift_tier1_handle: cfg.gift_tier1_handle || "",
    gift_tier2_threshold: Number(cfg.gift_tier2_threshold) || 3999,
    gift_tier2_name: cfg.gift_tier2_name || "",
    gift_tier2_handle: cfg.gift_tier2_handle || "",
  };

  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
};
