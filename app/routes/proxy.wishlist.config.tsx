import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// GET /apps/rewards/wishlist/config  → storefront reads enabled + color + placements
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "wishlist_config")
    .maybeSingle();

  let cfg: any = {};
  if (data?.value) {
    try { cfg = JSON.parse(data.value); } catch (e) { cfg = {}; }
  }

  const out = {
    enabled: cfg.enabled !== false,
    heart_color: typeof cfg.heart_color === "string" && /^#[0-9a-fA-F]{6}$/.test(cfg.heart_color)
      ? cfg.heart_color
      : "#ef4444",
    show_cards: cfg.show_cards !== false,
    show_pdp: cfg.show_pdp !== false,
    show_header: cfg.show_header !== false,
    show_mobile_nav: cfg.show_mobile_nav !== false,
  };

  return new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
};
