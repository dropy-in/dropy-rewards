import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// GET /apps/rewards/wishlist/list
// Returns the logged-in customer's wishlist with display data, so the client can
// hydrate localStorage (handles cross-device + "saved as guest then logged in").
// Also auto-syncs metafield data to Supabase mirror (backfill for pre-mirror saves).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return Response.json({ loggedIn: false, items: [] });

  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
  if (!customerId) return Response.json({ loggedIn: false, items: [] });

  const ownerId = `gid://shopify/Customer/${customerId}`;

  // 1. Read saved GIDs
  let gids: string[] = [];
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
      if (Array.isArray(parsed)) gids = parsed.filter((x) => typeof x === "string");
    }
  } catch (e) {
    return Response.json({ loggedIn: true, items: [] });
  }

  if (!gids.length) return Response.json({ loggedIn: true, items: [] });

  // 1b. Auto-sync: backfill Supabase mirror from metafield (non-critical, never blocks response)
  try {
    // Check which items are already mirrored
    const { data: existing } = await supabase
      .from("wishlist_items")
      .select("product_id")
      .eq("customer_id", customerId);

    const existingSet = new Set((existing || []).map((r: any) => r.product_id));
    const newGids = gids.filter((g) => !existingSet.has(g));

    if (newGids.length) {
      // Batch upsert new items to wishlist_items
      await supabase
        .from("wishlist_items")
        .upsert(
          newGids.map((gid) => ({ customer_id: customerId, product_id: gid })),
          { onConflict: "customer_id,product_id", ignoreDuplicates: true },
        );

      // Update product counts for each new item
      for (const gid of newGids) {
        const { data: pc } = await supabase
          .from("wishlist_product_counts")
          .select("product_id, logged_count")
          .eq("product_id", gid)
          .maybeSingle();

        if (pc) {
          await supabase
            .from("wishlist_product_counts")
            .update({ logged_count: ((pc as any).logged_count || 0) + 1, updated_at: new Date().toISOString() })
            .eq("product_id", gid);
        } else {
          await supabase
            .from("wishlist_product_counts")
            .insert({ product_id: gid, logged_count: 1, guest_count: 0 });
        }
      }
    }
  } catch (e) {
    /* backfill failed — non-critical, don't block the response */
  }

  // 2. Hydrate display data for those products
  let items: any[] = [];
  try {
    const res = await admin.graphql(
      `query ($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            handle
            title
            onlineStoreUrl
            featuredImage { url altText }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
            compareAtPriceRange { minVariantCompareAtPrice { amount } }
            totalInventory
            tracksInventory
          }
        }
      }`,
      { variables: { ids: gids } },
    );
    const data = await res.json();
    const nodes = data?.data?.nodes || [];
    items = nodes
      .filter((n: any) => n && n.id)
      .map((n: any) => {
        const price = parseFloat(n.priceRangeV2?.minVariantPrice?.amount || "0");
        const cmp = parseFloat(n.compareAtPriceRange?.minVariantCompareAtPrice?.amount || "0");
        const tracks = Boolean(n.tracksInventory);
        const inv = typeof n.totalInventory === "number" ? n.totalInventory : null;
        return {
          id: n.id,
          handle: n.handle,
          title: n.title,
          url: n.onlineStoreUrl || `/products/${n.handle}`,
          image: n.featuredImage?.url || "",
          price, // major units (e.g. rupees)
          compareAt: cmp > price ? cmp : 0,
          available: tracks ? (inv === null ? true : inv > 0) : true,
        };
      });
  } catch (e) {
    return Response.json({ loggedIn: true, items: [] });
  }

  return Response.json({ loggedIn: true, items });
};
