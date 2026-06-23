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

  if (loading || !d) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10 }}>
        <span style={{ width: 20, height: 20, border: "3px solid #e5e7eb", borderTopColor: "#fb923c", borderRadius: "50%", animation: "dw-spin 0.6s linear infinite", display: "inline-block" }} />
        <span style={{ color: "#6b7280", fontSize: 14 }}>Loading wishlist data…</span>
        <style>{`@keyframes dw-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!d.totalItems) {
    return (
      <div style={{ textAlign: "center", padding: "56px 24px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💝</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1f2937", marginBottom: 6 }}>No wishlist data yet</div>
        <div style={{ fontSize: 14, color: "#6b7280", maxWidth: 340, margin: "0 auto" }}>
          Once logged-in customers start saving products, their wishlists and insights will appear here.
        </div>
      </div>
    );
  }

  const medals = ["🥇", "🥈", "🥉"];

  function initials(name: string) {
    return name.split(" ").map((w: string) => w[0] || "").slice(0, 2).join("").toUpperCase();
  }

  const colors = ["#fb923c", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981", "#ef4444", "#f59e0b"];
  function avatarColor(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  }

  return (
    <div>
      {/* ── Stat cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { icon: "❤️", value: d.totalItems, label: "Items saved", bg: "linear-gradient(135deg, #fff5f5, #fff)" },
          { icon: "👥", value: d.totalCustomers, label: "Customers", bg: "linear-gradient(135deg, #f0f9ff, #fff)" },
          { icon: "📦", value: d.topProducts.length, label: "Unique products", bg: "linear-gradient(135deg, #fdf4ff, #fff)" },
        ].map((s) => (
          <div key={s.label} style={{
            background: s.bg, border: "1px solid #f3f4f6", borderRadius: 14, padding: "18px 20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {d.capped && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12, padding: "10px 14px", borderRadius: 10, marginBottom: 20 }}>
          ⚠️ Showing the first 250 customers/products.
        </div>
      )}

      {/* ── Most wishlisted ── */}
      <div style={{
        background: "#fff", border: "1px solid #f3f4f6", borderRadius: 16, padding: "20px 22px", marginBottom: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 18 }}>🔥</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Most wishlisted</span>
        </div>
        {d.topProducts.map((p: any, i: number) => (
          <div key={p.id} style={{
            display: "flex", alignItems: "center", gap: 14, padding: "10px 0",
            borderBottom: i < d.topProducts.length - 1 ? "1px solid #f9fafb" : "none",
          }}>
            <span style={{ width: 28, textAlign: "center", fontSize: i < 3 ? 18 : 13, fontWeight: 700, color: i < 3 ? undefined : "#d1d5db" }}>
              {i < 3 ? medals[i] : i + 1}
            </span>
            {p.image
              ? <img src={p.image} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", background: "#f9fafb", border: "1px solid #f3f4f6" }} />
              : <div style={{ width: 48, height: 48, borderRadius: 10, background: "#f3f4f6" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={p.url} target="_blank" rel="noreferrer" style={{
                fontSize: 13, fontWeight: 500, color: "#1f2937", textDecoration: "none", lineHeight: 1.4,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any, overflow: "hidden",
              }}>
                {p.title}
              </a>
            </div>
            <span style={{
              background: "linear-gradient(135deg, #fef2f2, #fff5f5)", color: "#ef4444", fontWeight: 700, fontSize: 12,
              padding: "4px 12px", borderRadius: 99, border: "1px solid #fecaca", whiteSpace: "nowrap",
            }}>
              {p.count} {p.count === 1 ? "save" : "saves"}
            </span>
          </div>
        ))}
      </div>

      {/* ── Customer wishlists ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>👤</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Customer wishlists</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#9ca3af" }}>{d.customers.length} customer{d.customers.length !== 1 ? "s" : ""}</span>
      </div>

      {d.customers.map((c: any) => (
        <div key={c.id} style={{
          background: "#fff", border: "1px solid #f3f4f6", borderRadius: 14, padding: "16px 20px", marginBottom: 12,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)", transition: "box-shadow 0.15s",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: c.items.length ? 12 : 0 }}>
            {/* Avatar */}
            <div style={{
              width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: avatarColor(c.name), color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>
              {initials(c.name)}
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{c.name}</div>
              <div style={{ fontSize: 12, color: "#9ca3af", display: "flex", flexWrap: "wrap", gap: 4 }}>
                {c.email && <span>{c.email}</span>}
                {c.orders > 0 && <span>· {c.orders} order{c.orders === 1 ? "" : "s"}</span>}
                {c.location && <span>· 📍 {c.location}</span>}
              </div>
            </div>
            {/* Badge */}
            <span style={{
              background: "#f0fdf4", color: "#16a34a", fontWeight: 700, fontSize: 12,
              padding: "4px 12px", borderRadius: 99, border: "1px solid #bbf7d0", whiteSpace: "nowrap",
            }}>
              {c.count} {c.count === 1 ? "item" : "items"}
            </span>
          </div>
          {/* Product chips */}
          {c.items.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 52 }}>
              {c.items.map((it: any) => (
                <a key={it.id} href={it.url} target="_blank" rel="noreferrer" title={it.title}
                   style={{
                     display: "flex", alignItems: "center", gap: 7, background: "#f9fafb", border: "1px solid #f3f4f6",
                     borderRadius: 10, padding: "5px 10px 5px 5px", textDecoration: "none", transition: "border-color 0.15s",
                   }}>
                  {it.image
                    ? <img src={it.image} alt="" style={{ width: 30, height: 30, borderRadius: 7, objectFit: "cover" }} />
                    : <div style={{ width: 30, height: 30, borderRadius: 7, background: "#e5e7eb" }} />}
                  <span style={{ fontSize: 12, color: "#374151", fontWeight: 500, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.title}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
