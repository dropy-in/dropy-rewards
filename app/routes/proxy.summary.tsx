import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { getConfig, listPrograms, listCoupons, tierStatus } from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request); // verifies Shopify signature
  const url = new URL(request.url);
  const cid = url.searchParams.get("logged_in_customer_id") || "";

  const [cfg, allPrograms, coupons, tier, balanceRes] = await Promise.all([
    getConfig(),
    listPrograms(),
    cid ? listCoupons(cid) : Promise.resolve([]),
    cid ? tierStatus(cid) : Promise.resolve(null),
    cid
      ? supabase.from("loyalty_balances").select("*").eq("customer_id", cid).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);
  const programs = allPrograms.filter((p: any) => p.active);

  let balance = { available: 0, pending: 0, lifetime_earned: 0 };
  if ((balanceRes as any)?.data) balance = (balanceRes as any).data;

  // Fetch store credit balance from Shopify
  let storeCredit: { amount: string; currency: string } | null = null;
  if (cid && admin) {
    try {
      const scRes = await admin.graphql(`
        query ($id: ID!) {
          customer(id: $id) {
            storeCreditAccounts(first: 5) {
              nodes { balance { amount currencyCode } }
            }
          }
        }
      `, { variables: { id: `gid://shopify/Customer/${cid}` } });
      const scData = await scRes.json();
      const accounts = scData?.data?.customer?.storeCreditAccounts?.nodes || [];
      let totalCredit = 0;
      let currency = "INR";
      accounts.forEach((a: any) => {
        totalCredit += parseFloat(a.balance.amount);
        currency = a.balance.currencyCode;
      });
      if (totalCredit > 0) storeCredit = { amount: totalCredit.toString(), currency };
    } catch (e) { /* store credit is non-critical — don't break the widget */ }
  }

  return Response.json({
    loggedIn: Boolean(cid),
    coupons,
    tier,
    balance,
    storeCredit,
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