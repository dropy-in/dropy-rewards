import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

type Tier = { threshold: number; handles: string[]; label: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request); // verifies Shopify signature
  const { data } = await supabase
    .from("loyalty_config")
    .select("key, value")
    .in("key", ["gift_enabled", "gift_tiers", "gift_threshold_paise", "gift_products"]);
  const c = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));

  // Prefer the multi-tier config. If gift_tiers isn't seeded yet (half-deploy), synthesize a
  // single tier from the legacy 3 keys so the gift never blanks out.
  let tiers: Tier[] = [];
  if (c.gift_tiers) {
    try {
      tiers = (JSON.parse(c.gift_tiers) as any[])
        .map((t) => ({
          threshold: parseInt(String(t.threshold_paise ?? t.threshold ?? 0), 10) || 0,
          handles: Array.isArray(t.handles) ? t.handles.map(String).filter(Boolean) : [],
          label: String(t.label ?? "free gift"),
        }))
        .filter((t) => t.handles.length > 0 && t.threshold > 0);
    } catch (e) {
      tiers = [];
    }
  }
  if (!tiers.length) {
    let handles: string[] = [];
    try {
      handles = (JSON.parse(c.gift_products ?? "[]") as Array<{ handle: string }>)
        .map((p) => p.handle)
        .filter(Boolean);
    } catch (e) {
      handles = [];
    }
    if (handles.length) {
      tiers = [{ threshold: parseInt(c.gift_threshold_paise ?? "249900", 10), handles, label: "free gift" }];
    }
  }

  const enabled = (c.gift_enabled ?? "0") === "1" && tiers.some((t) => t.handles.length > 0);

  return Response.json({
    enabled,
    tiers,
    // Legacy fields (first tier) kept as a superset so an older widget asset still renders the
    // gift during a half-deploy. The current widget reads `tiers` and ignores these.
    threshold: tiers[0]?.threshold ?? parseInt(c.gift_threshold_paise ?? "249900", 10),
    handles: tiers[0]?.handles ?? [],
  });
};
