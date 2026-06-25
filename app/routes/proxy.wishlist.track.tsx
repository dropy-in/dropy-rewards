import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// POST /apps/rewards/wishlist/track
// Anonymous-safe: tracks product-level wishlist saves for BOTH guests and logged-in.
// Body: { productId: "gid://shopify/Product/123", action: "add" | "remove" }
export const action = async ({ request }: { request: Request }) => {
  await authenticate.public.appProxy(request);

  const isLoggedIn = !!new URL(request.url).searchParams.get("logged_in_customer_id");
  const body = await request.json().catch(() => null);
  const productId = String(body?.productId || "");
  const act = body?.action === "remove" ? "remove" : "add";

  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const { data: existing } = await supabase
      .from("wishlist_product_counts")
      .select("product_id, guest_count, logged_count")
      .eq("product_id", productId)
      .maybeSingle();

    const delta = act === "add" ? 1 : -1;
    const gc = Math.max(0, ((existing as any)?.guest_count || 0) + (isLoggedIn ? 0 : delta));
    const lc = Math.max(0, ((existing as any)?.logged_count || 0) + (isLoggedIn ? delta : 0));

    if (existing) {
      await supabase
        .from("wishlist_product_counts")
        .update({ guest_count: gc, logged_count: lc, updated_at: new Date().toISOString() })
        .eq("product_id", productId);
    } else if (act === "add") {
      await supabase
        .from("wishlist_product_counts")
        .insert({
          product_id: productId,
          guest_count: isLoggedIn ? 0 : 1,
          logged_count: isLoggedIn ? 1 : 0,
        });
    }
  } catch (e) {
    /* non-critical */
  }

  return Response.json({ ok: true });
};
