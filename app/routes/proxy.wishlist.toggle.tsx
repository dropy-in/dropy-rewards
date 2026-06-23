import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// POST /apps/rewards/wishlist/toggle
// Body: { productId: "gid://shopify/Product/123", action: "add" | "remove" }
// Persists the customer's wishlist in customer metafield wishlist.items (list.product_reference).
// Guests get a 200 { loggedIn:false } — the client keeps their list in localStorage only.
export const action = async ({ request }: { request: Request }) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return Response.json({ error: "App not ready" }, { status: 500 });

  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
  if (!customerId) return Response.json({ loggedIn: false, items: [] });

  const body = await request.json().catch(() => null);
  const productId = String(body?.productId || "");
  const act = body?.action === "remove" ? "remove" : "add";
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId))
    return Response.json({ error: "Invalid productId" }, { status: 400 });

  const ownerId = `gid://shopify/Customer/${customerId}`;

  // 1. Read current list
  let current: string[] = [];
  try {
    const res = await admin.graphql(
      `query ($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "wishlist", key: "items") { value }
        }
      }`,
      { variables: { id: ownerId } },
    );
    const data = await res.json();
    const raw = data?.data?.customer?.metafield?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) current = parsed.filter((x) => typeof x === "string");
    }
  } catch (e) {
    /* treat as empty list */
  }

  // 2. Compute new list
  const set = new Set(current);
  if (act === "add") set.add(productId);
  else set.delete(productId);
  const next = Array.from(set);

  // 3. Write back
  try {
    const res = await admin.graphql(
      `mutation ($mf: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $mf) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          mf: [
            {
              ownerId,
              namespace: "wishlist",
              key: "items",
              type: "list.product_reference",
              value: JSON.stringify(next),
            },
          ],
        },
      },
    );
    const data = await res.json();
    const errs = data?.data?.metafieldsSet?.userErrors || [];
    if (errs.length) return Response.json({ error: errs[0].message }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }

  // Mirror to Supabase for the admin analytics tab (non-critical — never break the toggle)
  try {
    if (act === "add") {
      await supabase
        .from("wishlist_items")
        .upsert([{ customer_id: customerId, product_id: productId }], { onConflict: "customer_id,product_id" });
    } else {
      await supabase
        .from("wishlist_items")
        .delete()
        .eq("customer_id", customerId)
        .eq("product_id", productId);
    }
  } catch (e) {
    /* analytics mirror failed — ignore */
  }

  return Response.json({ loggedIn: true, items: next });
};
