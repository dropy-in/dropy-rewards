import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listCustomers } from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { customers: await listCustomers() };
};

export default function Customers() {
  const { customers } = useLoaderData<typeof loader>();
  const [q, setQ] = useState("");
  const rows = customers.filter(
    (c: any) =>
      !q ||
      [c.first_name, c.email, c.shopify_customer_id].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <s-page heading="Customers">
      <s-section>
        <s-search-field
          label="Search customers"
          placeholder="Search by name, email, or ID"
          onInput={(e: any) => setQ(e.currentTarget?.value ?? e.target?.value ?? "")}
        />
        {rows.length === 0 ? (
          <s-paragraph>No customers found.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Name</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header>Customer ID</s-table-header>
              <s-table-header format="numeric">Available</s-table-header>
              <s-table-header format="numeric">Pending</s-table-header>
              <s-table-header format="numeric">Lifetime</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((c: any) => (
                <s-table-row key={c.shopify_customer_id}>
                  <s-table-cell>{c.first_name ?? "—"}</s-table-cell>
                  <s-table-cell>{c.email ?? "—"}</s-table-cell>
                  <s-table-cell>{c.shopify_customer_id}</s-table-cell>
                  <s-table-cell>{c.available}</s-table-cell>
                  <s-table-cell>{c.pending}</s-table-cell>
                  <s-table-cell>{c.lifetime_earned}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}