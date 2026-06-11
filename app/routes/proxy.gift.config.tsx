import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request); // verifies Shopify signature
  const { data } = await supabase
    .from("loyalty_config")
    .select("key, value")
    .in("key", ["gift_enabled", "gift_threshold_paise", "gift_products"]);
  const c = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  let handles: string[] = [];
  try {
    handles = (JSON.parse(c.gift_products ?? "[]") as Array<{ handle: string }>)
      .map((p) => p.handle)
      .filter(Boolean);
  } catch (e) {
    handles = [];
  }
  return Response.json({
    enabled: (c.gift_enabled ?? "0") === "1" && handles.length > 0,
    threshold: parseInt(c.gift_threshold_paise ?? "249900", 10),
    handles,
  });
};