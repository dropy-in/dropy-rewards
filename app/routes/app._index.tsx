import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [ledger, log, balances] = await Promise.all([
    supabase.from("loyalty_ledger").select("*").order("id", { ascending: false }).limit(20),
    supabase.from("loyalty_webhook_log").select("*").order("id", { ascending: false }).limit(10),
    supabase.from("loyalty_balances").select("*").limit(10),
  ]);
  return {
    ledger: ledger.data ?? [],
    log: log.data ?? [],
    balances: balances.data ?? [],
  };
};

const cell: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #e3e3e3", fontSize: 13, textAlign: "left" };

function Table({ title, rows, cols }: { title: string; rows: any[]; cols: string[] }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ color: "#777", fontSize: 13 }}>No rows yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>{cols.map((c) => <th key={c} style={{ ...cell, fontWeight: 600 }}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c} style={cell}>{String(r[c] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Index() {
  const { ledger, log, balances } = useLoaderData<typeof loader>();
  return (
    <div style={{ padding: 20, background: "#f6f6f7", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Dropy Rewards — Engine Monitor</h1>
      <p style={{ color: "#777", margin: "0 0 20px", fontSize: 13 }}>Phase 1 · earning engine · live ledger</p>
      <Table title="Balances" rows={balances} cols={["customer_id", "available", "pending", "lifetime_earned"]} />
      <Table title="Ledger (latest 20)" rows={ledger} cols={["id", "customer_id", "type", "points", "order_name", "available_at", "note", "created_at"]} />
      <Table title="Webhook log (latest 10)" rows={log} cols={["id", "topic", "ref", "ok", "message", "created_at"]} />
    </div>
  );
}