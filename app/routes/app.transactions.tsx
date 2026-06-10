import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listTransactions } from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { txns: await listTransactions() };
};

const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function Transactions() {
  const { txns } = useLoaderData<typeof loader>();
  const [q, setQ] = useState("");
  const rows = txns.filter(
    (t: any) =>
      !q ||
      [t.order_name, t.customer_id, t.type, t.note].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <s-page heading="Transactions">
      <s-section>
        <s-search-field
          label="Search transactions"
          placeholder="Search by order, customer ID, or type"
          onInput={(e: any) => setQ(e.currentTarget?.value ?? e.target?.value ?? "")}
        />
        {rows.length === 0 ? (
          <s-paragraph>No transactions yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>ID</s-table-header>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header format="numeric">Points</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((t: any) => {
                const pending = t.available_at && new Date(t.available_at) > new Date();
                const tone = t.type.startsWith("earn") ? "success" : t.type === "adjust" ? "info" : "critical";
                return (
                  <s-table-row key={t.id}>
                    <s-table-cell>{t.id}</s-table-cell>
                    <s-table-cell>{t.order_name ?? "—"}</s-table-cell>
                    <s-table-cell>{t.customer_id}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={tone}>{t.type}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{t.points}</s-table-cell>
                    <s-table-cell>{pending ? `Pending · unlocks ${dt(t.available_at)}` : "Available"}</s-table-cell>
                    <s-table-cell>{dt(t.created_at)}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}