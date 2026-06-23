import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GET /apps/rewards/wishlist/list
// Returns the logged-in customer's wishlist with display data, so the client can
// hydrate localStorage (handles cross-device + "saved as guest then logged in").
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
