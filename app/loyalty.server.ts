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
    placeOrderEnabled: (c.place_order_enabled ?? "1") === "1",
    signupEnabled: (c.signup_enabled ?? "1") === "1",
    vipEnabled: (c.vip_enabled ?? "0") === "1",
    tierBufferDays: parseInt(c.tier_buffer_days ?? "7", 10),
    tierWindowDays: parseInt(c.tier_window_days ?? "0", 10),
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

export async function earnFromOrder(order: any, admin?: any): Promise<string> {
  const cfg = await getConfig();
  if (!cfg.placeOrderEnabled) return "place-order-disabled";
  const cust = order?.customer;
  if (!cust?.id) return "no-customer";
  await upsertCustomer(cust);
  // subtotal_price = post-discount, pre-shipping → COD fee (shipping rate) auto-excluded
  const orderPaise = paise(order.subtotal_price);
  let pts = calcPoints(orderPaise, cfg);
  let tierNote: string | null = null;
  if (cfg.vipEnabled && pts > 0) {
    const tier = await getCustomerTier(String(cust.id));
    if (tier) {
      if (Number(tier.multiplier) > 1) {
        pts = Math.floor(pts * Number(tier.multiplier));
        tierNote = `${tier.name} ${tier.multiplier}x`;
      }
      await awardTierRewards(admin, String(cust.id), tier);
    }
  }
  if (pts <= 0) return "zero-points";
  const availableAt = new Date(Date.now() + cfg.pendingDays * 86_400_000).toISOString();
  const { error } = await supabase.from("loyalty_ledger").insert({
    customer_id: String(cust.id),
    type: "earn_order",
    points: pts,
    order_id: String(order.id),
    order_name: order.name ?? null,
    available_at: availableAt,
    amount_paise: orderPaise,
    note: tierNote,
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
    amount_paise: -refundPaise,
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
  if (!cfg.signupEnabled || cfg.signupPoints <= 0) return "signup-disabled";
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

// ---------- Phase 2.5: redemption programs + toggles ----------

export async function setConfigKey(key: string, value: string) {
  const allowed = ["place_order_enabled", "signup_enabled", "vip_enabled"];
  if (!allowed.includes(key)) throw new Error("key not allowed");
  const { error } = await supabase.from("loyalty_config").upsert({ key, value: value === "1" ? "1" : "0" });
  if (error) throw error;
}

export async function listPrograms() {
  const { data } = await supabase.from("loyalty_programs").select("*").order("id", { ascending: false });
  return data ?? [];
}

export async function createProgram(p: {
  type: string;
  name: string;
  discount_kind?: string | null;
  discount_value?: number | null;
  points_required: number;
  min_order_amount?: number | null;
  product_id?: string | null;
  product_title?: string | null;
}) {
  const { error } = await supabase.from("loyalty_programs").insert(p);
  if (error) throw error;
}

export async function setProgramActive(id: number, active: boolean) {
  const { error } = await supabase.from("loyalty_programs").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deleteProgram(id: number) {
  const { error } = await supabase.from("loyalty_programs").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Phase 4: redemption engine ----------

const genCode = () =>
  "DRPY-" + Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

async function createShopifyReward(admin: any, program: any, customerId: string, opts: { permanent?: boolean } = {}) {
  const customerGid = `gid://shopify/Customer/${customerId}`;
  const code = genCode();
  const base = {
    title: `Rewards: ${program.name} (${code})`,
    code,
    startsAt: new Date().toISOString(),
    usageLimit: opts.permanent ? null : 1,
    appliesOncePerCustomer: !opts.permanent,
    customerSelection: { customers: { add: [customerGid] } },
  };

  if (program.type === "store_credit") {
    const shopRes = await admin.graphql(`{ shop { currencyCode } }`);
    const currency = (await shopRes.json()).data.shop.currencyCode;
    const amount = Number(program.discount_value ?? 0).toFixed(2);
    const res = await admin.graphql(
      `#graphql
      mutation credit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction { amount { amount currencyCode } }
          userErrors { field message }
        }
      }`,
      { variables: { id: customerGid, creditInput: { creditAmount: { amount, currencyCode: currency } } } },
    );
    const j = await res.json();
    if (j.errors) throw new Error("GraphQL: " + JSON.stringify(j.errors));
    const errs = j.data?.storeCreditAccountCredit?.userErrors;
    if (errs?.length) throw new Error(errs.map((e: any) => e.message).join(", "));
    return { code: null, detail: `₹${amount} store credit added`, discountId: null as string | null };
  }

  if (program.type === "free_shipping") {
    const res = await admin.graphql(
      `#graphql
      mutation fs($d: DiscountCodeFreeShippingInput!) {
        discountCodeFreeShippingCreate(freeShippingCodeDiscount: $d) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }`,
      { variables: { d: { ...base } } },
    );
    const j = await res.json();
    const errs = j.data?.discountCodeFreeShippingCreate?.userErrors;
    if (errs?.length) throw new Error(errs.map((e: any) => e.message).join(", "));
    return { code, detail: "Free shipping code", discountId: j.data?.discountCodeFreeShippingCreate?.codeDiscountNode?.id ?? null };
  }

  // discount + free_gift → basic code discount
  const isGift = program.type === "free_gift";
  const customerGets = isGift
    ? {
        value: { percentage: 1.0 },
        items: { products: { productsToAdd: [program.product_id] } },
      }
    : {
        value:
          program.discount_kind === "percentage"
            ? { percentage: Number(program.discount_value) / 100 }
            : { discountAmount: { amount: Number(program.discount_value).toFixed(2), appliesOnEachItem: false } },
        items: { all: true },
      };

  const d: any = { ...base, customerGets };
  if (Number(program.min_order_amount) > 0) {
    d.minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: Number(program.min_order_amount).toFixed(2) } };
  }

  const res = await admin.graphql(
    `#graphql
    mutation basic($d: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $d) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`,
    { variables: { d } },
  );
  const j = await res.json();
  const errs = j.data?.discountCodeBasicCreate?.userErrors;
  if (errs?.length) throw new Error(errs.map((e: any) => e.message).join(", "));
  return { code, detail: isGift ? `Free: ${program.product_title}` : "Discount code", discountId: j.data?.discountCodeBasicCreate?.codeDiscountNode?.id ?? null };
}

export async function redeemProgram(admin: any, customerId: string, programId: number) {
  const { data: program } = await supabase.from("loyalty_programs").select("*").eq("id", programId).maybeSingle();
  if (!program || !program.active) return { ok: false, error: "Program not available" };

  const { data: bal } = await supabase.from("loyalty_balances").select("*").eq("customer_id", customerId).maybeSingle();
  const available = bal?.available ?? 0;
  if (available < program.points_required) return { ok: false, error: "Not enough points" };

  // 1) deduct points
  const { data: ledgerRow, error: ledgerErr } = await supabase
    .from("loyalty_ledger")
    .insert({
      customer_id: customerId,
      type: "redeem",
      points: -program.points_required,
      note: `redeem: ${program.name}`,
    })
    .select("id")
    .single();
  if (ledgerErr) throw ledgerErr;

  // 2) create the reward in Shopify — rollback points on failure
  let reward;
  try {
    reward = await createShopifyReward(admin, program, customerId);
  } catch (e) {
    console.error("[redeem] reward creation failed:", e);
    await supabase.from("loyalty_ledger").delete().eq("id", ledgerRow.id);
    return { ok: false, error: "Could not create reward. Points not deducted." };
  }

  // 3) record redemption
  await supabase.from("loyalty_redemptions").insert({
    customer_id: customerId,
    ledger_id: ledgerRow.id,
    program_id: program.id,
    reward_type: program.type,
    points_spent: program.points_required,
    value_paise: program.discount_value ? Math.round(Number(program.discount_value) * 100) : null,
    shopify_ref: reward.code,
    shopify_discount_id: (reward as any).discountId ?? null,
    title: program.name,
  });

  return { ok: true, type: program.type, name: program.name, code: reward.code, detail: reward.detail };
}

export async function listCoupons(customerId: string) {
  const { data } = await supabase
    .from("loyalty_redemptions")
    .select("shopify_ref, reward_type, points_spent, created_at, title, loyalty_programs(name)")
    .eq("customer_id", customerId)
    .order("id", { ascending: false })
    .limit(5);
  return (data ?? []).map((r: any) => ({
    code: r.shopify_ref,
    type: r.reward_type,
    name: r.title ?? r.loyalty_programs?.name ?? r.reward_type,
    points: r.points_spent,
    date: r.created_at,
  }));
}

// ---------- Phase 5: VIP tiers ----------

export async function listTiers() {
  const { data } = await supabase.from("loyalty_tiers").select("*").order("entry_amount", { ascending: true });
  return data ?? [];
}

export async function createTier(t: any) {
  const { error } = await supabase.from("loyalty_tiers").insert(t);
  if (error) throw error;
}

export async function deleteTier(id: number) {
  const { error } = await supabase.from("loyalty_tiers").delete().eq("id", id);
  if (error) throw error;
}

export async function setTierBuffer(days: number) {
  const { error } = await supabase.from("loyalty_config").upsert({ key: "tier_buffer_days", value: String(Math.max(0, Math.round(days))) });
  if (error) throw error;
}

export async function getSpend(customerId: string) {
  const { data } = await supabase.from("loyalty_spend").select("*").eq("customer_id", customerId).maybeSingle();
  return { total: (data?.total_paise ?? 0) / 100, buffered: (data?.buffered_paise ?? 0) / 100 };
}

export async function getCustomerTier(customerId: string) {
  const [tiers, spend] = await Promise.all([listTiers(), getSpend(customerId)]);
  let current: any = null;
  for (const t of tiers) if (spend.buffered >= Number(t.entry_amount)) current = t;
  return current; // sorted ascending — highest qualifying tier wins
}

export async function tierStatus(customerId: string) {
  const cfg = await getConfig();
  if (!cfg.vipEnabled) return null;
  const [tiers, spend] = await Promise.all([listTiers(), getSpend(customerId)]);
  if (!tiers.length) return null;
  let current: any = null;
  let next: any = null;
  for (const t of tiers) {
    if (spend.buffered >= Number(t.entry_amount)) current = t;
    else if (!next) next = t;
  }
  return {
    name: current?.name ?? null,
    multiplier: current ? Number(current.multiplier) : 1,
    spend: spend.buffered,
    next: next ? { name: next.name, entry: Number(next.entry_amount), toGo: Math.max(0, Number(next.entry_amount) - spend.buffered) } : null,
  };
}

export async function setTierWindow(days: number) {
  const { error } = await supabase.from("loyalty_config").upsert({ key: "tier_window_days", value: String(Math.max(0, Math.round(days))) });
  if (error) throw error;
}

// ---------- tier entry rewards + ongoing privileges ----------

async function awardTierRewards(admin: any, customerId: string, tier: any) {
  const entryType = tier.entry_reward_type ?? "none";
  const ongoingType = tier.ongoing_type ?? "none";
  if (entryType === "none" && ongoingType === "none") return;

  // dedup gate — one award per customer per tier, ever (idx_tier_bonus_once)
  const { error: gateErr } = await supabase.from("loyalty_ledger").insert({
    customer_id: customerId,
    type: "earn_tier",
    points: entryType === "points" ? Number(tier.entry_bonus_points ?? 0) : 0,
    ref_id: `tier-${tier.id}`,
    note: `Welcome to ${tier.name}`,
  });
  if (gateErr) return; // already awarded (23505) — exit silently
  if (!admin) {
    console.error("[tier-reward] no admin context, code rewards skipped for", customerId, tier.name);
    return;
  }

  try {
    if (["discount", "free_gift", "free_shipping"].includes(entryType)) {
      const reward = await createShopifyReward(
        admin,
        {
          type: entryType,
          name: `${tier.name} welcome`,
          discount_kind: tier.entry_discount_kind,
          discount_value: tier.entry_discount_value,
          min_order_amount: 0,
          product_id: tier.entry_product_id,
          product_title: tier.entry_product_title,
        },
        customerId,
      );
      await supabase.from("loyalty_redemptions").insert({
        customer_id: customerId,
        reward_type: entryType,
        points_spent: 0,
        shopify_ref: reward.code,
        shopify_discount_id: (reward as any).discountId ?? null,
        title: `${tier.name} welcome gift`,
      });
    }
    if (["discount", "free_gift", "free_shipping"].includes(ongoingType)) {
      const reward = await createShopifyReward(
        admin,
        {
          type: ongoingType,
          name: `${tier.name} privilege`,
          discount_kind: tier.ongoing_discount_kind,
          discount_value: tier.ongoing_discount_value,
          min_order_amount: 0,
          product_id: tier.ongoing_product_id,
          product_title: tier.ongoing_product_title,
        },
        customerId,
        { permanent: true },
      );
      await supabase.from("loyalty_redemptions").insert({
        customer_id: customerId,
        reward_type: ongoingType,
        points_spent: 0,
        shopify_ref: reward.code,
        shopify_discount_id: (reward as any).discountId ?? null,
        title: `${tier.name} privilege · reusable`,
      });
    }
  } catch (e) {
    console.error("[tier-reward]", e);
  }
}