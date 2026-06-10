import { supabase } from "./supabase.server";

export async function getConfig() {
  const { data, error } = await supabase.from("loyalty_config").select("key, value");
  if (error) throw error;
  const c = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return {
    earnAmount: parseInt(c.earn_amount_rupees ?? "100", 10),
    earnPoints: parseInt(c.earn_points ?? "10", 10),
    pendingDays: parseInt(c.pending_days ?? "7", 10),
    signupPoints: parseInt(c.signup_points ?? "10", 10),
    pointValuePaise: parseInt(c.point_value_paise ?? "30", 10),
  };
}

const paise = (s: unknown) => Math.round(parseFloat(String(s ?? "0")) * 100);

// inback style: floor(amount / earnAmount × earnPoints) — Floor 4.7 → 4
const calcPoints = (amountPaise: number, cfg: { earnAmount: number; earnPoints: number }) =>
  Math.floor((amountPaise * cfg.earnPoints) / (cfg.earnAmount * 100));

async function upsertCustomer(c: { id: unknown; email?: string | null; first_name?: string | null }) {
  await supabase.from("loyalty_customers").upsert({
    shopify_customer_id: String(c.id),
    email: c.email ?? null,
    first_name: c.first_name ?? null,
  });
}

export async function logWebhook(topic: string, webhookId: string | null, ref: string, ok: boolean, message: string) {
  await supabase.from("loyalty_webhook_log").insert({ topic, webhook_id: webhookId, ref, ok, message });
}

export async function earnFromOrder(order: any): Promise<string> {
  const cfg = await getConfig();
  const cust = order?.customer;
  if (!cust?.id) return "no-customer";
  await upsertCustomer(cust);
  // subtotal_price = post-discount, pre-shipping → COD fee (shipping rate) auto-excluded
  const pts = calcPoints(paise(order.subtotal_price), cfg);
  if (pts <= 0) return "zero-points";
  const availableAt = new Date(Date.now() + cfg.pendingDays * 86_400_000).toISOString();
  const { error } = await supabase.from("loyalty_ledger").insert({
    customer_id: String(cust.id),
    type: "earn_order",
    points: pts,
    order_id: String(order.id),
    order_name: order.name ?? null,
    available_at: availableAt,
  });
  if (error) {
    if (error.code === "23505") return "duplicate-order"; // unique index hit
    throw error;
  }
  return `earned ${pts} (pending ${cfg.pendingDays}d)`;
}

export async function clawbackFromRefund(refund: any): Promise<string> {
  const cfg = await getConfig();
  const orderId = String(refund.order_id);
  let refundPaise = 0;
  for (const t of refund.transactions ?? []) {
    if (t.kind === "refund" && ["success", "pending"].includes(t.status)) refundPaise += paise(t.amount);
  }
  const clawPts = calcPoints(refundPaise, cfg);
  if (clawPts <= 0) return "zero-refund";

  const { data: earn } = await supabase
    .from("loyalty_ledger")
    .select("id, customer_id, points, available_at")
    .eq("order_id", orderId)
    .eq("type", "earn_order")
    .maybeSingle();
  if (!earn) return "no-earn-entry";

  // dedup placeholder — duplicate refund webhook hits unique index and exits
  const refId = `refund-${refund.id}`;
  const { error: insErr } = await supabase.from("loyalty_ledger").insert({
    customer_id: earn.customer_id,
    type: "clawback",
    points: 0,
    order_id: orderId,
    ref_id: refId,
  });
  if (insErr) {
    if (insErr.code === "23505") return "duplicate-refund";
    throw insErr;
  }

  let remaining = clawPts;
  const stillPending = earn.available_at && new Date(earn.available_at) > new Date();
  if (stillPending) {
    const reduce = Math.min(earn.points, remaining);
    await supabase.from("loyalty_ledger").update({ points: earn.points - reduce }).eq("id", earn.id);
    remaining -= reduce;
  }
  await supabase
    .from("loyalty_ledger")
    .update({ points: -remaining, note: remaining === 0 ? "absorbed-by-pending" : `clawback ${remaining}` })
    .eq("ref_id", refId)
    .eq("type", "clawback");
  return `clawback ${clawPts} (active: ${remaining}, pending-cut: ${clawPts - remaining})`;
}

export async function signupPoints(customer: any): Promise<string> {
  const cfg = await getConfig();
  if (!customer?.id) return "no-id";
  await upsertCustomer(customer);
  if (cfg.signupPoints <= 0) return "signup-disabled";
  const { error } = await supabase.from("loyalty_ledger").insert({
    customer_id: String(customer.id),
    type: "earn_signup",
    points: cfg.signupPoints,
  });
  if (error) {
    if (error.code === "23505") return "duplicate-signup";
    throw error;
  }
  return `signup +${cfg.signupPoints}`;
}

// ---------- Phase 2: admin queries ----------

export async function getMetrics() {
  const { data, error } = await supabase.from("loyalty_metrics").select("*").single();
  if (error) throw error;
  return data as {
    customers: number; points_order: number; points_signup: number;
    points_redeemed: number; points_pending: number; points_available: number;
  };
}

export async function updateConfig(entries: Record<string, string>) {
  const allowed = ["earn_amount_rupees", "earn_points", "pending_days", "signup_points", "point_value_paise"];
  const rows = Object.entries(entries)
    .filter(([k]) => allowed.includes(k))
    .map(([key, value]) => ({ key, value: String(Math.max(0, parseInt(String(value || "0"), 10) || 0)) }));
  const { error } = await supabase.from("loyalty_config").upsert(rows);
  if (error) throw error;
}

export async function listCustomers() {
  const [{ data: customers }, { data: balances }] = await Promise.all([
    supabase.from("loyalty_customers").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("loyalty_balances").select("*"),
  ]);
  const bal = new Map((balances ?? []).map((b: any) => [b.customer_id, b]));
  return (customers ?? []).map((c: any) => ({
    ...c,
    ...(bal.get(c.shopify_customer_id) ?? { available: 0, pending: 0, lifetime_earned: 0 }),
  }));
}

export async function listTransactions() {
  const { data } = await supabase
    .from("loyalty_ledger")
    .select("*")
    .order("id", { ascending: false })
    .limit(100);
  return data ?? [];
}

export async function recentWebhooks(n = 8) {
  const { data } = await supabase
    .from("loyalty_webhook_log")
    .select("*")
    .order("id", { ascending: false })
    .limit(n);
  return data ?? [];
}