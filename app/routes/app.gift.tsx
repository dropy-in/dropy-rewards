import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { setConfigKey } from "../loyalty.server";

type GiftProduct = { handle: string; title: string };
type AdminTier = { thresholdRupees: number; products: GiftProduct[]; label: string };
type StateTier = AdminTier & { uid: string };

let uidSeq = 0;
const nextUid = () => `t${uidSeq++}`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const { data } = await supabase
    .from("loyalty_config")
    .select("key, value")
    .in("key", ["gift_enabled", "gift_tiers", "gift_threshold_paise", "gift_products"]);
  const c = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));

  let tiers: AdminTier[] = [];
  if (c.gift_tiers) {
    try {
      tiers = (JSON.parse(c.gift_tiers) as any[]).map((t) => ({
        thresholdRupees: Math.round((parseInt(String(t.threshold_paise ?? 0), 10) || 0) / 100),
        // gift_tiers stores handles only; titles aren't persisted (the storefront fetches them).
        products: (Array.isArray(t.handles) ? t.handles : []).map((h: string) => ({ handle: String(h), title: String(h) })),
        label: String(t.label ?? "free gift"),
      }));
    } catch (e) {
      tiers = [];
    }
  }
  if (!tiers.length) {
    // Synthesize a single tier from the legacy 3 keys (back-compat before gift_tiers is seeded).
    let products: GiftProduct[] = [];
    try {
      products = JSON.parse(c.gift_products ?? "[]");
    } catch (e) {
      products = [];
    }
    tiers = [{ thresholdRupees: Math.round(parseInt(c.gift_threshold_paise ?? "249900", 10) / 100), products, label: "free gift" }];
  }

  return { enabled: (c.gift_enabled ?? "0") === "1", tiers };
};

// Sync the gift tiers into the app-owned shop metafield $app:gift/tiers that the
// gift-discount Shopify Function reads. Supabase (loyalty_config "gift_tiers") stays the source
// of truth; this is a denormalized read-model for the Function. App-owned ($app) metafields are
// writable by the app without the metafields access scopes. Best-effort: never fail the save.
async function syncGiftMetafield(
  admin: any,
  tiers: Array<{ threshold_paise: number; handles: string[]; label: string }>,
) {
  try {
    const shopRes = await admin.graphql(`#graphql
      query GiftShopId { shop { id } }`);
    const shopId = (await shopRes.json())?.data?.shop?.id;
    if (!shopId) {
      console.error("[gift] metafield sync: no shop id");
      return;
    }
    const res = await admin.graphql(
      `#graphql
      mutation SetGiftTiers($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message code }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopId,
              namespace: "$app:gift",
              key: "tiers",
              type: "json",
              value: JSON.stringify({ tiers }),
            },
          ],
        },
      },
    );
    const ue = (await res.json())?.data?.metafieldsSet?.userErrors;
    if (ue?.length) console.error("[gift] metafield sync userErrors", JSON.stringify(ue));
  } catch (e: any) {
    console.error("[gift] metafield sync failed", e?.message || e);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "toggle") {
    await setConfigKey("gift_enabled", String(form.get("enabled")));
    return { ok: true };
  }

  if (intent === "save") {
    let tiers: any[] = [];
    try {
      tiers = JSON.parse(String(form.get("tiers") ?? "[]"));
    } catch (e) {
      tiers = [];
    }
    const clean = tiers
      .map((t) => ({
        threshold_paise: Math.round((parseFloat(String(t.thresholdRupees ?? "0")) || 0) * 100),
        handles: (Array.isArray(t.products) ? t.products : [])
          .map((p: any) => String(p?.handle ?? ""))
          .filter(Boolean)
          .slice(0, 3),
        label: String(t.label ?? "free gift").trim() || "free gift",
      }))
      .filter((t) => t.handles.length > 0 && t.threshold_paise > 0);

    const { error } = await supabase
      .from("loyalty_config")
      .upsert([{ key: "gift_tiers", value: JSON.stringify(clean) }]);
    if (error) throw error;

    // Push the same tiers to the Function's config metafield so the discount stays in sync.
    await syncGiftMetafield(admin, clean);
    return { ok: true };
  }

  return { ok: false };
};

export default function GiftPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [tiers, setTiers] = useState<StateTier[]>(() => data.tiers.map((t) => ({ ...t, uid: nextUid() })));

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  const val = (id: string) => String((document.getElementById(id) as any)?.value ?? "");

  const pickProducts = async (uid: string) => {
    const selected = await (shopify as any).resourcePicker({ type: "product", multiple: 3 });
    const list = (selected?.selection ?? selected ?? []) as any[];
    if (!list.length) return;
    const products = list.slice(0, 3).map((p: any) => ({ handle: String(p.handle ?? ""), title: String(p.title ?? "") }));
    setTiers((prev) => prev.map((t) => (t.uid === uid ? { ...t, products } : t)));
  };

  const removeProduct = (uid: string, idx: number) =>
    setTiers((prev) => prev.map((t) => (t.uid === uid ? { ...t, products: t.products.filter((_, j) => j !== idx) } : t)));

  const addTier = () =>
    setTiers((prev) => [...prev, { uid: nextUid(), thresholdRupees: 0, products: [], label: "free gift" }]);

  const removeTier = (uid: string) => setTiers((prev) => prev.filter((t) => t.uid !== uid));

  const save = () => {
    // threshold + label are uncontrolled (keyed by stable uid); products live in state.
    const payload = tiers.map((t) => ({
      thresholdRupees: val(`gift-threshold-${t.uid}`),
      label: val(`gift-label-${t.uid}`),
      products: t.products,
    }));
    fetcher.submit({ intent: "save", tiers: JSON.stringify(payload) }, { method: "POST" });
  };

  const toggle = () => fetcher.submit({ intent: "toggle", enabled: data.enabled ? "0" : "1" }, { method: "POST" });

  return (
    <s-page heading="Free Gift Popup">
      <s-section heading="Status">
        <s-stack direction="inline" gap="base">
          <s-badge tone={data.enabled ? "success" : undefined}>{data.enabled ? "Enabled" : "Disabled"}</s-badge>
          <s-button onClick={toggle}>{data.enabled ? "Disable" : "Enable"}</s-button>
        </s-stack>
        <s-paragraph>
          When enabled, the storefront popup offers a free gift at each tier as the cart (excluding gifts) crosses that
          tier&apos;s threshold. Tiers are cumulative — crossing a higher tier keeps the lower gifts. Changes apply
          instantly, no theme edit needed.
        </s-paragraph>
      </s-section>

      <s-section heading="Gift tiers">
        <s-stack direction="block" gap="large">
          {tiers.map((t, ti) => (
            <s-box key={t.uid} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-heading>Tier {ti + 1}</s-heading>
                  <s-button tone="critical" onClick={() => removeTier(t.uid)}>Remove tier</s-button>
                </s-stack>

                <s-number-field
                  id={`gift-threshold-${t.uid}`}
                  label="Cart threshold (₹)"
                  min={1}
                  value={String(t.thresholdRupees)}
                />
                <s-text-field id={`gift-label-${t.uid}`} label="Gift label (shown in the popup footer)" value={t.label} />

                <s-paragraph><b>Gift products (max 3)</b> — customer picks one, first variant is added.</s-paragraph>
                {t.products.length === 0 && <s-paragraph>No products selected yet.</s-paragraph>}
                {t.products.map((p, i) => (
                  <s-stack key={p.handle + i} direction="inline" gap="base">
                    <s-paragraph>
                      {i + 1}. {p.title} <span style={{ opacity: 0.6 }}>({p.handle})</span>
                    </s-paragraph>
                    <s-button onClick={() => removeProduct(t.uid, i)}>Remove</s-button>
                  </s-stack>
                ))}
                <s-button onClick={() => pickProducts(t.uid)}>Pick products</s-button>
              </s-stack>
            </s-box>
          ))}

          <s-stack direction="inline" gap="base">
            <s-button onClick={addTier}>Add tier</s-button>
            <s-button variant="primary" onClick={save}>Save</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
