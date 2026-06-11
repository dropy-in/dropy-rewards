import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";
import { updateConfig, setConfigKey } from "../loyalty.server";

type GiftProduct = { handle: string; title: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const { data } = await supabase
    .from("loyalty_config")
    .select("key, value")
    .in("key", ["gift_enabled", "gift_threshold_paise", "gift_products"]);
  const c = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  let products: GiftProduct[] = [];
  try {
    products = JSON.parse(c.gift_products ?? "[]");
  } catch (e) {
    products = [];
  }
  return {
    enabled: (c.gift_enabled ?? "0") === "1",
    thresholdRupees: Math.round(parseInt(c.gift_threshold_paise ?? "249900", 10) / 100),
    products,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "toggle") {
    await setConfigKey("gift_enabled", String(form.get("enabled")));
    return { ok: true };
  }

  if (intent === "save") {
    const rupees = parseFloat(String(form.get("threshold_rupees") ?? "0")) || 0;
    let products: GiftProduct[] = [];
    try {
      products = JSON.parse(String(form.get("products") ?? "[]"));
    } catch (e) {
      products = [];
    }
    await updateConfig({
      gift_threshold_paise: String(Math.round(rupees * 100)),
      gift_products: JSON.stringify(
        products
          .filter((p) => p && p.handle)
          .slice(0, 3)
          .map((p) => ({ handle: String(p.handle), title: String(p.title ?? p.handle) })),
      ),
    });
    return { ok: true };
  }

  return { ok: false };
};

export default function GiftPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [products, setProducts] = useState<GiftProduct[]>(data.products);

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  const val = (id: string) => String((document.getElementById(id) as any)?.value ?? "");

  const pickProducts = async () => {
    const selected = await (shopify as any).resourcePicker({ type: "product", multiple: 3 });
    const list = (selected?.selection ?? selected ?? []) as any[];
    if (!list.length) return;
    setProducts(
      list.slice(0, 3).map((p: any) => ({
        handle: String(p.handle ?? ""),
        title: String(p.title ?? ""),
      })),
    );
  };

  const save = () =>
    fetcher.submit(
      { intent: "save", threshold_rupees: val("gift-threshold"), products: JSON.stringify(products) },
      { method: "POST" },
    );

  const toggle = () =>
    fetcher.submit({ intent: "toggle", enabled: data.enabled ? "0" : "1" }, { method: "POST" });

  return (
    <s-page heading="Free Gift Popup">
      <s-section heading="Status">
        <s-stack direction="inline" gap="base">
          <s-badge tone={data.enabled ? "success" : undefined}>{data.enabled ? "Enabled" : "Disabled"}</s-badge>
          <s-button onClick={toggle}>{data.enabled ? "Disable" : "Enable"}</s-button>
        </s-stack>
        <s-paragraph>
          When enabled, the storefront popup offers one free gift when the cart (excluding the gift) crosses the
          threshold. Changes apply instantly — no theme edit needed.
        </s-paragraph>
      </s-section>

      <s-section heading="Settings">
        <s-stack direction="block" gap="base">
          <s-number-field id="gift-threshold" label="Cart threshold (₹)" min={1} value={String(data.thresholdRupees)} />

          <s-paragraph><b>Gift products (max 3)</b> — customer picks one, first variant is added.</s-paragraph>
          {products.length === 0 && <s-paragraph>No products selected yet.</s-paragraph>}
          {products.map((p, i) => (
            <s-stack key={p.handle + i} direction="inline" gap="base">
              <s-paragraph>
                {i + 1}. {p.title} <span style={{ opacity: 0.6 }}>({p.handle})</span>
              </s-paragraph>
              <s-button onClick={() => setProducts(products.filter((_, j) => j !== i))}>Remove</s-button>
            </s-stack>
          ))}

          <s-stack direction="inline" gap="base">
            <s-button onClick={pickProducts}>Pick products</s-button>
            <s-button variant="primary" onClick={save}>Save</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}