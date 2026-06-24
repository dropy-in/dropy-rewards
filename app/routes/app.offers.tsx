import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// Master offers config — single source of truth for all promo values.
// Storefront JS reads via proxy.offers.config.tsx and applies everywhere.

const DEFAULTS = {
  discount_code: "FIRST200",
  discount_amount: 200,
  discount_minimum: 1999,
  free_shipping_threshold: 1499,
  gift_tier1_threshold: 2499,
  gift_tier1_name: "CeraVe Foaming Facial Cleanser 87ml",
  gift_tier1_handle: "",
  gift_tier2_threshold: 3999,
  gift_tier2_name: "The Ordinary Squalane",
  gift_tier2_handle: "",
  cod_min: 499,
  cod_max: 2998,
  partial_min: 2999,
  partial_max: 10000,
  partial_deposit: 25,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "offers_config")
    .maybeSingle();

  let cfg: any = {};
  try { cfg = data?.value ? JSON.parse(data.value) : {}; } catch (e) { cfg = {}; }

  return { ...DEFAULTS, ...cfg };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();

  const num = (k: string, d: number) => {
    const v = parseFloat(String(form.get(k) ?? ""));
    return isNaN(v) ? d : v;
  };

  const config = {
    discount_code: String(form.get("discount_code") ?? DEFAULTS.discount_code).trim().toUpperCase(),
    discount_amount: num("discount_amount", DEFAULTS.discount_amount),
    discount_minimum: num("discount_minimum", DEFAULTS.discount_minimum),
    free_shipping_threshold: num("free_shipping_threshold", DEFAULTS.free_shipping_threshold),
    gift_tier1_threshold: num("gift_tier1_threshold", DEFAULTS.gift_tier1_threshold),
    gift_tier1_name: String(form.get("gift_tier1_name") ?? "").trim(),
    gift_tier1_handle: String(form.get("gift_tier1_handle") ?? "").trim(),
    gift_tier2_threshold: num("gift_tier2_threshold", DEFAULTS.gift_tier2_threshold),
    gift_tier2_name: String(form.get("gift_tier2_name") ?? "").trim(),
    gift_tier2_handle: String(form.get("gift_tier2_handle") ?? "").trim(),
    cod_min: num("cod_min", DEFAULTS.cod_min),
    cod_max: num("cod_max", DEFAULTS.cod_max),
    partial_min: num("partial_min", DEFAULTS.partial_min),
    partial_max: num("partial_max", DEFAULTS.partial_max),
    partial_deposit: num("partial_deposit", DEFAULTS.partial_deposit),
  };

  const { error } = await supabase
    .from("loyalty_config")
    .upsert([{ key: "offers_config", value: JSON.stringify(config) }]);
  if (error) throw error;
  return { ok: true };
};

export default function OffersPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.ok;

  const [v, setV] = useState(data);
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));

  function save() {
    const fd = new FormData();
    Object.entries(v).forEach(([k, val]) => fd.set(k, String(val)));
    fetcher.submit(fd, { method: "post" });
  }

  const card: React.CSSProperties = {
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
    padding: "16px 20px", marginBottom: 20,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 14,
    display: "flex", alignItems: "center", gap: 8,
  };
  const fieldRow: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14,
  };
  const fieldRow3: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14,
  };
  const label: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4,
  };
  const input: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8,
    fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const hint: React.CSSProperties = {
    fontSize: 11, color: "#9ca3af", marginTop: 2,
  };
  const manualTag: React.CSSProperties = {
    display: "inline-block", background: "#fef3c7", color: "#92400e", fontSize: 10,
    fontWeight: 700, padding: "2px 6px", borderRadius: 4, marginLeft: 6, verticalAlign: "middle",
  };
  const autoTag: React.CSSProperties = {
    display: "inline-block", background: "#dcfce7", color: "#166534", fontSize: 10,
    fontWeight: 700, padding: "2px 6px", borderRadius: 4, marginLeft: 6, verticalAlign: "middle",
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Offers</h1>
        <button onClick={save} disabled={saving} style={{
          padding: "10px 22px", background: "#1a1a1a", color: "#fff", border: 0,
          borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? "default" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 22 }}>
        Central config for all promotions. Changes marked <span style={autoTag}>AUTO</span> update the storefront
        within ~5 min. Items marked <span style={manualTag}>MANUAL</span> need a separate update.
      </p>

      {/* ── Discount code ── */}
      <div style={card}>
        <div style={sectionTitle}>🏷️ Discount code <span style={autoTag}>AUTO</span></div>
        <div style={fieldRow3}>
          <div>
            <label style={label}>Code</label>
            <input style={{ ...input, fontFamily: "monospace", textTransform: "uppercase" }} value={v.discount_code} onChange={(e) => set("discount_code", e.target.value)} />
            <div style={hint}>Shown in exit popup, coupon card</div>
          </div>
          <div>
            <label style={label}>Amount (₹)</label>
            <input type="number" style={input} value={v.discount_amount} onChange={(e) => set("discount_amount", e.target.value)} />
          </div>
          <div>
            <label style={label}>Minimum cart (₹)</label>
            <input type="number" style={input} value={v.discount_minimum} onChange={(e) => set("discount_minimum", e.target.value)} />
          </div>
        </div>
        <div style={{ ...hint, background: "#f9fafb", padding: "8px 10px", borderRadius: 6, marginTop: -4 }}>
          ⚠️ Also update: <strong>Shopify Admin → Discounts → {v.discount_code}</strong> to match these values.
          <span style={manualTag}>MANUAL</span>
        </div>
      </div>

      {/* ── Free shipping ── */}
      <div style={card}>
        <div style={sectionTitle}>🚚 Free shipping <span style={autoTag}>AUTO</span></div>
        <div style={{ maxWidth: 260 }}>
          <label style={label}>Free shipping above (₹)</label>
          <input type="number" style={input} value={v.free_shipping_threshold} onChange={(e) => set("free_shipping_threshold", e.target.value)} />
          <div style={hint}>Progress bar + shipping bar update automatically</div>
        </div>
        <div style={{ ...hint, background: "#f9fafb", padding: "8px 10px", borderRadius: 6, marginTop: 10 }}>
          ⚠️ Also update: <strong>Shopify → Settings → Shipping → Standard Shipping rate</strong> free-above tier.
          <span style={manualTag}>MANUAL</span>
        </div>
      </div>

      {/* ── Free gifts ── */}
      <div style={card}>
        <div style={sectionTitle}>🎁 Free gifts <span style={autoTag}>AUTO</span></div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Tier 1</div>
        <div style={fieldRow3}>
          <div>
            <label style={label}>Threshold (₹)</label>
            <input type="number" style={input} value={v.gift_tier1_threshold} onChange={(e) => set("gift_tier1_threshold", e.target.value)} />
          </div>
          <div>
            <label style={label}>Product name</label>
            <input style={input} value={v.gift_tier1_name} onChange={(e) => set("gift_tier1_name", e.target.value)} />
          </div>
          <div>
            <label style={label}>Product handle</label>
            <input style={input} value={v.gift_tier1_handle} onChange={(e) => set("gift_tier1_handle", e.target.value)} placeholder="cerave-foaming-cleanser..." />
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8, marginTop: 6 }}>Tier 2</div>
        <div style={fieldRow3}>
          <div>
            <label style={label}>Threshold (₹)</label>
            <input type="number" style={input} value={v.gift_tier2_threshold} onChange={(e) => set("gift_tier2_threshold", e.target.value)} />
          </div>
          <div>
            <label style={label}>Product name</label>
            <input style={input} value={v.gift_tier2_name} onChange={(e) => set("gift_tier2_name", e.target.value)} />
          </div>
          <div>
            <label style={label}>Product handle</label>
            <input style={input} value={v.gift_tier2_handle} onChange={(e) => set("gift_tier2_handle", e.target.value)} placeholder="the-ordinary-squalane..." />
          </div>
        </div>
        <div style={{ ...hint, background: "#f9fafb", padding: "8px 10px", borderRadius: 6, marginTop: 4 }}>
          ⚠️ Also update: <strong>Shopify → Discounts → FREEGIFT2499</strong> (BxGy rule) to match threshold/product.
          <span style={manualTag}>MANUAL</span>
        </div>
      </div>

      {/* ── COD / Partial ── */}
      <div style={card}>
        <div style={sectionTitle}>💰 COD & Partial Payment <span style={manualTag}>MANUAL</span></div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          Reference values only — update these in <strong>Releasit</strong> and <strong>Shopify Shipping</strong>.
        </div>
        <div style={fieldRow}>
          <div>
            <label style={label}>COD range (₹)</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" style={{ ...input, width: "45%" }} value={v.cod_min} onChange={(e) => set("cod_min", e.target.value)} />
              <span style={{ color: "#9ca3af" }}>–</span>
              <input type="number" style={{ ...input, width: "45%" }} value={v.cod_max} onChange={(e) => set("cod_max", e.target.value)} />
            </div>
          </div>
          <div>
            <label style={label}>Partial range (₹) / Deposit %</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" style={{ ...input, width: "35%" }} value={v.partial_min} onChange={(e) => set("partial_min", e.target.value)} />
              <span style={{ color: "#9ca3af" }}>–</span>
              <input type="number" style={{ ...input, width: "35%" }} value={v.partial_max} onChange={(e) => set("partial_max", e.target.value)} />
              <input type="number" style={{ ...input, width: "20%" }} value={v.partial_deposit} onChange={(e) => set("partial_deposit", e.target.value)} />
              <span style={{ fontSize: 12, color: "#6b7280" }}>%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Manual checklist ── */}
      <div style={{ ...card, background: "#fffbeb", borderColor: "#fde68a" }}>
        <div style={sectionTitle}>📋 After changing any offer — also update:</div>
        <div style={{ fontSize: 13, color: "#78716c", lineHeight: 1.8 }}>
          <div>☐ <strong>Shopify → Discounts</strong> — update code amount/minimum/BxGy rules</div>
          <div>☐ <strong>Shopify → Shipping</strong> — update Standard Shipping free-above tier</div>
          <div>☐ <strong>Releasit</strong> — update COD range / Partial Payment range</div>
          <div>☐ <strong>Google Ads</strong> — update ad copy if offer text changed</div>
          <div>☐ <strong>WhatsApp templates</strong> — update recovery messages (needs Meta re-approval)</div>
          <div>☐ <strong>AEO FAQ metafields</strong> — update product pages mentioning offers/pricing</div>
        </div>
      </div>

      <p style={{ color: "#9ca3af", fontSize: 11 }}>
        <span style={autoTag}>AUTO</span> fields update the storefront within ~5 min (exit popup, progress bar, gift popup, shipping bar).
        <span style={manualTag}>MANUAL</span> items need separate platform updates.
      </p>
    </div>
  );
}
