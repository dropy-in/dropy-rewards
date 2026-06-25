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
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "-apple-system, system-ui, sans-serif" }}>
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
  const [search, setSearch] = useState("");

  if (loading || !d) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10 }}>
        <span style={{ width: 20, height: 20, border: "3px solid #e5e7eb", borderTopColor: "#fb923c", borderRadius: "50%", animation: "dw-spin 0.6s linear infinite", display: "inline-block" }} />
        <span style={{ color: "#6b7280", fontSize: 14 }}>Loading wishlist data…</span>
        <style>{`@keyframes dw-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!d.totalItems && (!d.productCounts || !d.productCounts.length)) {
    return (
      <div style={{ textAlign: "center", padding: "56px 24px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💝</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1f2937", marginBottom: 6 }}>No wishlist data yet</div>
        <div style={{ fontSize: 14, color: "#6b7280", maxWidth: 340, margin: "0 auto" }}>
          Once customers start saving products, their wishlists will appear here.
        </div>
      </div>
    );
  }

  const pc = d.productCounts || [];
  const totalGuest = pc.reduce((s: number, p: any) => s + (p.guest || 0), 0);
  const totalLogged = pc.reduce((s: number, p: any) => s + (p.logged || 0), 0);

  // flatten into rows: one row per customer×product
  const rows: any[] = [];
  (d.customers || []).forEach((c: any) => {
    (c.items || []).forEach((it: any, idx: number) => {
      rows.push({
        customerName: c.name,
        customerEmail: c.email,
        location: c.location || "",
        orders: c.orders || 0,
        productTitle: it.title,
        productImage: it.image,
        productUrl: it.url,
        addedAt: c.lastAdded,
        itemCount: c.count,
        isFirst: idx === 0,
        customerId: c.id,
      });
    });
  });

  const q = search.toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        r.customerName.toLowerCase().includes(q) ||
        r.customerEmail.toLowerCase().includes(q) ||
        r.productTitle.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q)
      )
    : rows;

  const th: React.CSSProperties = {
    padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#6b7280", textAlign: "left",
    borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.04em",
  };
  const td: React.CSSProperties = {
    padding: "10px 12px", fontSize: 13, color: "#374151", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle",
  };

  return (
    <div>
      {/* ── Stat cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { icon: "❤️", value: totalGuest + totalLogged, label: "Total saves", accent: "#ef4444" },
          { icon: "👤", value: totalLogged, label: "Logged-in", accent: "#3b82f6" },
          { icon: "👻", value: totalGuest, label: "Guest", accent: "#8b5cf6" },
          { icon: "📦", value: pc.length, label: "Products", accent: "#10b981" },
        ].map((s) => (
          <div key={s.label} style={{
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px",
            borderLeft: `4px solid ${s.accent}`,
          }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#111827" }}>{s.value}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Product Insights ── */}
      {pc.length > 0 && (
        <div style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 24,
        }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            <span>🔥</span> Product Insights
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400, color: "#9ca3af" }}>Guest + logged-in saves</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ ...th, width: "5%" }}>#</th>
                <th style={th}>Product</th>
                <th style={{ ...th, textAlign: "center", width: "12%" }}>👻 Guest</th>
                <th style={{ ...th, textAlign: "center", width: "12%" }}>👤 Logged</th>
                <th style={{ ...th, textAlign: "center", width: "12%" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {pc.map((p: any, i: number) => (
                <tr key={p.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, color: "#d1d5db" }}>{i + 1}</td>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {p.image
                        ? <img src={p.image} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", background: "#f3f4f6", flexShrink: 0 }} />
                        : <div style={{ width: 32, height: 32, borderRadius: 6, background: "#f3f4f6", flexShrink: 0 }} />}
                      <a href={p.url} target="_blank" rel="noreferrer" style={{
                        fontSize: 13, color: "#1f2937", textDecoration: "none", fontWeight: 500,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
                      }}>{p.title}</a>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {p.guest > 0 ? <span style={{ background: "#f3e8ff", color: "#7c3aed", fontWeight: 700, fontSize: 12, padding: "2px 10px", borderRadius: 99 }}>{p.guest}</span> : <span style={{ color: "#e5e7eb" }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {p.logged > 0 ? <span style={{ background: "#dbeafe", color: "#2563eb", fontWeight: 700, fontSize: 12, padding: "2px 10px", borderRadius: 99 }}>{p.logged}</span> : <span style={{ color: "#e5e7eb" }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <span style={{ background: "#fef2f2", color: "#ef4444", fontWeight: 700, fontSize: 12, padding: "2px 10px", borderRadius: 99 }}>{p.total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Customer Table ── */}
      {(d.customers || []).length > 0 && (
      <>
      {/* ── Search ── */}
      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
          <input
            type="text"
            placeholder="Search by customer, product, or location"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8,
              fontSize: 13, outline: "none", background: "#f9fafb",
            }}
          />
        </div>

        {/* ── Table ── */}
        <div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ ...th, width: "22%" }}>Customer</th>
                <th style={{ ...th, width: "15%" }}>Location</th>
                <th style={th}>Product</th>
                <th style={{ ...th, textAlign: "center", width: "8%" }}>Saves</th>
                <th style={{ ...th, textAlign: "center", width: "8%" }}>Orders</th>
                <th style={{ ...th, textAlign: "right", width: "16%" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: "center", color: "#9ca3af", padding: "32px 12px" }}>
                    {q ? "No results matching your search" : "No data"}
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={td}>
                    {r.isFirst ? (
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customerName}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customerEmail || "—"}</div>
                      </div>
                    ) : (
                      <span style={{ color: "#d1d5db" }}>↳</span>
                    )}
                  </td>
                  <td style={td}>
                    {r.isFirst && r.location ? (
                      <span style={{ fontSize: 12, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>📍 {r.location}</span>
                    ) : r.isFirst ? (
                      <span style={{ color: "#d1d5db" }}>—</span>
                    ) : null}
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.productImage
                        ? <img src={r.productImage} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", background: "#f3f4f6", flexShrink: 0 }} />
                        : <div style={{ width: 32, height: 32, borderRadius: 6, background: "#f3f4f6", flexShrink: 0 }} />}
                      <a href={r.productUrl} target="_blank" rel="noreferrer" style={{
                        fontSize: 13, color: "#1f2937", textDecoration: "none", fontWeight: 500,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
                      }}>
                        {r.productTitle}
                      </a>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {r.isFirst && (
                      <span style={{
                        background: "#fef2f2", color: "#ef4444", fontWeight: 700, fontSize: 12,
                        padding: "2px 10px", borderRadius: 99,
                      }}>
                        {r.itemCount}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {r.isFirst && (
                      <span style={{ fontSize: 13, color: "#374151" }}>{r.orders}</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                    {r.isFirst && r.addedAt ? new Date(r.addedAt).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    }) + ", " + new Date(r.addedAt).toLocaleTimeString("en-IN", {
                      hour: "numeric", minute: "2-digit", hour12: true,
                    }) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#9ca3af", display: "flex", justifyContent: "space-between" }}>
          <span>{filtered.length} {filtered.length === 1 ? "entry" : "entries"}{q ? ` (filtered from ${rows.length})` : ""}</span>
          {d.capped && <span style={{ color: "#d97706" }}>⚠️ Capped at 250</span>}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
