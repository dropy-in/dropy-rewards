import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { getConfig, listPrograms, listCoupons, tierStatus } from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request); // verifies Shopify signature
  const url = new URL(request.url);
  const cid = url.searchParams.get("logged_in_customer_id") || "";

  const [cfg, allPrograms] = await Promise.all([getConfig(), listPrograms()]);
  const coupons = cid ? await listCoupons(cid) : [];
  const tier = cid ? await tierStatus(cid) : null;
  const programs = allPrograms.filter((p: any) => p.active);

  let balance = { available: 0, pending: 0, lifetime_earned: 0 };
  if (cid) {
    const { data } = await supabase
      .from("loyalty_balances")
      .select("*")
      .eq("customer_id", cid)
      .maybeSingle();
    if (data) balance = data as any;
  }

  return Response.json({
    loggedIn: Boolean(cid),
    coupons,
    tier,
    balance,
    config: {
      earnAmount: cfg.earnAmount,
      earnPoints: cfg.earnPoints,
      signupPoints: cfg.signupPoints,
      pointValuePaise: cfg.pointValuePaise,
      placeOrderEnabled: cfg.placeOrderEnabled,
      signupEnabled: cfg.signupEnabled,
      pendingDays: cfg.pendingDays,
    },
    programs: programs.map((p: any) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      points: p.points_required,
      detail:
        p.type === "discount"
          ? `${p.discount_kind === "percentage" ? p.discount_value + "%" : "₹" + p.discount_value} off`
          : p.type === "free_gift"
            ? p.product_title || "Free gift"
            : p.type === "store_credit"
              ? `₹${p.discount_value} store credit`
              : "Free shipping",
    })),
  });
};