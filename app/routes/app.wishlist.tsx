import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// Wishlist settings stored in loyalty_config row (key "wishlist_config") as JSON.
// Storefront reads via proxy.wishlist.config.tsx.
// Shape: { enabled, heart_color, show_cards, show_pdp, show_header, show_mobile_nav }

const DEFAULTS = {
  enabled: true,
  heart_color: "#ef4444",
  show_cards: true,
  show_pdp: true,
  show_header: true,
  show_mobile_nav: true,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "wishlist_config")
    .maybeSingle();

  let cfg: any = {};
  try { cfg = data?.value ? JSON.parse(data.value) : {}; } catch (e) { cfg = {}; }

  return {
    enabled: cfg.enabled !== false,
    heart_color: String(cfg.heart_color ?? DEFAULTS.heart_color),
    show_cards: cfg.show_cards !== false,
    show_pdp: cfg.show_pdp !== false,
    show_header: cfg.show_header !== false,
    show_mobile_nav: cfg.show_mobile_nav !== false,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();

  let color = String(form.get("heart_color") ?? DEFAULTS.heart_color).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = DEFAULTS.heart_color;

  const config = {
    enabled: form.get("enabled") === "1",
    heart_color: color,
    show_cards: form.get("show_cards") === "1",
    show_pdp: form.get("show_pdp") === "1",
    show_header: form.get("show_header") === "1",
    show_mobile_nav: form.get("show_mobile_nav") === "1",
  };

  const { error } = await supabase
    .from("loyalty_config")
    .upsert([{ key: "wishlist_config", value: JSON.stringify(config) }]);
  if (error) throw error;
  return { ok: true };
};

export default function WishlistSettings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";
  const saved = fetcher.data?.ok;

  const [enabled, setEnabled] = useState(data.enabled);
  const [color, setColor] = useState(data.heart_color);
  const [showCards, setShowCards] = useState(data.show_cards);
  const [showPdp, setShowPdp] = useState(data.show_pdp);
  const [showHeader, setShowHeader] = useState(data.show_header);
  const [showMobile, setShowMobile] = useState(data.show_mobile_nav);

  const [tab, setTab] = useState<"settings" | "data">("settings");
  const dataFetcher = useFetcher<any>();
  useEffect(() => {
    if (tab === "data" && dataFetcher.state === "idle" && !dataFetcher.data) {
      dataFetcher.load("/app/wishlist-data");
    }
  }, [tab]);

  function save() {
    const fd = new FormData();
    fd.set("enabled", enabled ? "1" : "0");
    fd.set("heart_color", color);
    fd.set("show_cards", showCards ? "1" : "0");
    fd.set("show_pdp", showPdp ? "1" : "0");
    fd.set("show_header", showHeader ? "1" : "0");
    fd.set("show_mobile_nav", showMobile ? "1" : "0");
    fetcher.submit(fd, { method: "post" });
  }

  const presets = ["#ef4444", "#fb923c", "#ec4899", "#8b5cf6", "#06b6d4", "#10b981", "#000000"];

  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 0", borderBottom: "1px solid #e5e7eb",
  };
  const card: React.CSSProperties = {
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
    padding: "8px 20px", marginBottom: 20,
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Wishlist</h1>
        {tab === "settings" && (
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: "10px 22px", background: "#1a1a1a", color: "#fff", border: 0,
              borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 22 }}>
        {([["settings", "Settings"], ["data", "Customer Data"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "10px 16px", border: 0, background: "none", cursor: "pointer",
              fontSize: 14, fontWeight: 600,
              color: tab === key ? "#1a1a1a" : "#9ca3af",
              borderBottom: tab === key ? "2px solid #1a1a1a" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "data" ? (
        <WishlistDataView fetcher={dataFetcher} />
      ) : (
      <>
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>
        Let shoppers save products to a wishlist. Works for guests (saved on device) and syncs to their
        account when they log in.
      </p>

      {/* Master toggle */}
      <div style={card}>
        <div style={{ ...row, borderBottom: "none" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Enable wishlist</div>
            <div style={{ color: "#6b7280", fontSize: 13 }}>Master switch for all wishlist hearts &amp; the page.</div>
          </div>
          <Toggle on={enabled} set={setEnabled} />
        </div>
      </div>

      {/* Heart color */}
      <div style={card}>
        <div style={{ padding: "14px 0" }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>Heart color (when saved)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setColor(p)}
                aria-label={p}
                style={{
                  width: 34, height: 34, borderRadius: "50%", background: p, cursor: "pointer",
                  border: color.toLowerCase() === p ? "3px solid #1a1a1a" : "2px solid #e5e7eb",
                }}
              />
            ))}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: 40, height: 34, border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer", padding: 2 }}
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: 90, padding: "7px 9px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13, fontFamily: "monospace" }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Placements */}
      <div style={card}>
        <div style={row}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>Show on product cards</span>
          <Toggle on={showCards} set={setShowCards} />
        </div>
        <div style={row}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>Show on product pages</span>
          <Toggle on={showPdp} set={setShowPdp} />
        </div>
        <div style={row}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>Show in desktop header</span>
          <Toggle on={showHeader} set={setShowHeader} />
        </div>
        <div style={{ ...row, borderBottom: "none" }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>Show in mobile nav bar</span>
          <Toggle on={showMobile} set={setShowMobile} />
        </div>
      </div>

      <p style={{ color: "#9ca3af", fontSize: 12 }}>
        Changes apply within ~5 minutes (storefront caches the config). The wishlist page lives at
        <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 4, margin: "0 4px" }}>/pages/wishlist</code>.
      </p>
      </>
      )}
    </div>
  );
}

function Toggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      onClick={() => set(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 46, height: 26, borderRadius: 99, border: 0, cursor: "pointer", position: "relative",
        background: on ? "#10b981" : "#d1d5db", transition: "background 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%",
          background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function WishlistDataView({ fetcher }: { fetcher: any }) {
  const loading = fetcher.state === "loading";
  const d = fetcher.data;

  const card: React.CSSProperties = {
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, marginBottom: 20,
  };

  if (loading || !d) {
    return <div style={{ color: "#6b7280", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading wishlist data…</div>;
  }

  if (!d.totalItems) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No wishlist data yet</div>
        <div style={{ fontSize: 14 }}>
          Once logged-in customers start saving products, their wishlists will appear here.
        </div>
      </div>
    );
  }

  const stat: React.CSSProperties = {
    flex: 1, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px",
  };

  return (
    <div>
      {/* Summary stats */}
      <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
        <div style={stat}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a" }}>{d.totalItems}</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>Items saved</div>
        </div>
        <div style={stat}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a" }}>{d.totalCustomers}</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>Customers</div>
        </div>
        <div style={stat}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a" }}>{d.topProducts.length}</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>Unique products</div>
        </div>
      </div>

      {d.capped && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e", fontSize: 12, padding: "8px 12px", borderRadius: 8, marginBottom: 18 }}>
          Showing the first 250 customers/products. Export coming soon for full data.
        </div>
      )}

      {/* Most wishlisted */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>🔥 Most wishlisted products</div>
        {d.topProducts.map((p: any, i: number) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < d.topProducts.length - 1 ? "1px solid #f3f4f6" : "none" }}>
            <span style={{ width: 22, color: "#9ca3af", fontWeight: 700, fontSize: 13 }}>{i + 1}</span>
            {p.image
              ? <img src={p.image} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", background: "#f3f4f6" }} />
              : <div style={{ width: 40, height: 40, borderRadius: 8, background: "#f3f4f6" }} />}
            <a href={p.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, color: "#1f2937", textDecoration: "none", lineHeight: 1.3 }}>
              {p.title}
            </a>
            <span style={{ background: "#fef2f2", color: "#ef4444", fontWeight: 700, fontSize: 12, padding: "3px 10px", borderRadius: 99 }}>
              {p.count} {p.count === 1 ? "save" : "saves"}
            </span>
          </div>
        ))}
      </div>

      {/* Per-customer */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>👤 Customer wishlists</div>
        {d.customers.map((c: any, ci: number) => (
          <div key={c.id} style={{ padding: "12px 0", borderBottom: ci < d.customers.length - 1 ? "1px solid #f3f4f6" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#1f2937" }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  {c.email || "—"}{c.orders ? ` · ${c.orders} order${c.orders === 1 ? "" : "s"}` : ""}{c.location ? ` · 📍 ${c.location}` : ""}
                </div>
              </div>
              <span style={{ background: "#f3f4f6", color: "#6b7280", fontWeight: 600, fontSize: 12, padding: "3px 10px", borderRadius: 99 }}>
                {c.count} {c.count === 1 ? "item" : "items"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {c.items.map((it: any) => (
                <a key={it.id} href={it.url} target="_blank" rel="noreferrer" title={it.title}
                   style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1px solid #f3f4f6", borderRadius: 8, padding: "4px 8px 4px 4px", textDecoration: "none" }}>
                  {it.image
                    ? <img src={it.image} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: "cover" }} />
                    : <div style={{ width: 26, height: 26, borderRadius: 5, background: "#e5e7eb" }} />}
                  <span style={{ fontSize: 11, color: "#4b5563", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.title}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
