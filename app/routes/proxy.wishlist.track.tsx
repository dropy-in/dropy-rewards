import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// POST /apps/rewards/wishlist/track
// Anonymous-safe: tracks product-level wishlist saves for BOTH guests and logged-in.
// Body: { productId: "gid://shopify/Product/123", action: "add" | "remove" }
// Determines source from logged_in_customer_id presence.
export const action = async ({ request }: { request: Request }) => {
  await authenticate.public.appProxy(request);

  const isLoggedIn = !!new URL(request.url).searchParams.get("logged_in_customer_id");
  const body = await request.json().catch(() => null);
  const productId = String(body?.productId || "");
  const act = body?.action === "remove" ? "remove" : "add";

  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const col = isLoggedIn ? "logged_count" : "guest_count";
  const delta = act === "add" ? 1 : -1;

  try {
    // Try upsert with increment
    if (act === "add") {
      // Insert or increment
      const { data: existing } = await supabase
        .from("wishlist_product_counts")
        .select("product_id, guest_count, logged_count")
        .eq("product_id", productId)
        .maybeSingle();

      if (existing) {
        const newVal = Math.max(0, (existing[col as keyof typeof existing] as number || 0) + delta);
        await supabase
          .from("wishlist_product_counts")
          .update({ [col]: newVal, updated_at: new Date().toISOString() })
          .eq("product_id", productId);
      } else {
        await supabase
          .from("wishlist_product_counts")
          .insert({ product_id: productId, [col]: 1 });
      }
    } else {
      // Decrement (min 0)
      const { data: existing } = await supabase
        .from("wishlist_product_counts")
        .select("product_id, guest_count, logged_count")
        .eq("product_id", productId)
        .maybeSingle();

      if (existing) {
        const newVal = Math.max(0, (existing[col as keyof typeof existing] as number || 0) + delta);
        await supabase
          .from("wishlist_product_counts")
          .update({ [col]: newVal, updated_at: new Date().toISOString() })
          .eq("product_id", productId);
      }
    }
  } catch (e) {
    /* non-critical — never break the UX */
  }

  return Response.json({ ok: true });
};
