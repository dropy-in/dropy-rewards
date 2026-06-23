import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// GET /app/wishlist-data — analytics for the admin "Customer Data" tab.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // 1. Pull mirror rows
  const { data: rows, error } = await supabase
    .from("wishlist_items")
    .select("customer_id, product_id, added_at")
    .order("added_at", { ascending: false })
    .limit(5000);

  if (error || !rows || !rows.length) {
    return Response.json({
      totalItems: 0, totalCustomers: 0, topProducts: [], customers: [], capped: false,
    });
  }

  // 2. Group
  const byCustomer: Record<string, { product_id: string; added_at: string }[]> = {};
  const productCount: Record<string, number> = {};
  rows.forEach((r: any) => {
    (byCustomer[r.customer_id] ||= []).push({ product_id: r.product_id, added_at: r.added_at });
    productCount[r.product_id] = (productCount[r.product_id] || 0) + 1;
  });

  const allProductIds = Object.keys(productCount);
  const allCustomerIds = Object.keys(byCustomer);
  const productIds = allProductIds.slice(0, 250);
  const customerIds = allCustomerIds.slice(0, 250).map((c) => `gid://shopify/Customer/${c}`);
  const capped = allProductIds.length > 250 || allCustomerIds.length > 250;

  // 3. Hydrate — TWO separate queries to isolate failures
  const productMap: Record<string, any> = {};
  const customerMap: Record<string, any> = {};

  // Hydrate products
  if (productIds.length) {
    try {
      const res = await admin.graphql(
        `query HydrateProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              handle
              onlineStoreUrl
              featuredImage { url }
            }
          }
        }`,
        { variables: { ids: productIds } },
      );
      const raw = await res.json();
      const nodes = raw?.data?.nodes || [];
      nodes.forEach((p: any) => {
        if (p && p.id) {
          productMap[p.id] = {
            id: p.id,
            title: p.title || "Untitled",
            handle: p.handle || "",
            url: p.onlineStoreUrl || `/products/${p.handle}`,
            image: p.featuredImage?.url || "",
          };
        }
      });
    } catch (e: any) {
      /* product hydration failed */
    }
  }

  // Hydrate customers
  if (customerIds.length) {
    try {
      const res = await admin.graphql(
        `query HydrateCustomers($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Customer {
              id
              displayName
              numberOfOrders
              defaultEmailAddress { emailAddress }
            }
          }
        }`,
        { variables: { ids: customerIds } },
      );
      const raw = await res.json();
      const nodes = raw?.data?.nodes || [];
      nodes.forEach((c: any) => {
        if (c && c.id) {
          const numId = c.id.split("/").pop();
          customerMap[numId!] = {
            id: numId,
            name: c.displayName || "Unknown",
            email: c.defaultEmailAddress?.emailAddress || "",
            orders: c.numberOfOrders || 0,
          };
        }
      });
    } catch (e: any) {
      /* customer hydration failed */
    }
  }

  // 4. Top products
  const topProducts = allProductIds
    .map((pid) => ({
      ...(productMap[pid] || { id: pid, title: pid, handle: "", url: "#", image: "" }),
      count: productCount[pid],
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // 5. Per-customer
  const customers = allCustomerIds
    .map((cid) => {
      const list = byCustomer[cid];
      const lastAdded = list.reduce((m, i) => (i.added_at > m ? i.added_at : m), list[0].added_at);
      const info = customerMap[cid] || { id: cid, name: "Customer " + cid, email: "", orders: 0 };
      return {
        ...info,
        count: list.length,
        lastAdded,
        items: list
          .map((i) => productMap[i.product_id] || { id: i.product_id, title: i.product_id, handle: "", url: "#", image: "" })
          .slice(0, 50),
      };
    })
    .sort((a, b) => (a.lastAdded > b.lastAdded ? -1 : 1));

  return Response.json({
    totalItems: rows.length,
    totalCustomers: allCustomerIds.length,
    topProducts,
    customers,
    capped,
  });
};
