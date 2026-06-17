import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// The progress bar config lives in a single loyalty_config row (key "bar_config") as a JSON
// string. The storefront reads it via the app-proxy route proxy.bar.config.tsx. Shape:
//   {
//     enabled: boolean,
//     tiers: [ { threshold_paise: int, label: string, type: string } ],   // up to 3
//     messages: { below_t1, t1_reached, t2_reached, all_reached }         // templates ({remaining})
//   }
// The theme JS reads messages by name (cfg.messages.below_t1, .t1_reached, .t2_reached,
// .all_reached) — these keys must match EXACTLY. Thresholds are stored in PAISE (₹ x 100) to
// match the rest of the app and the storefront's cart.total_price; the admin works in rupees.

const TIER_COUNT = 3;

const TYPES = [
  { value: "free_shipping", label: "Free shipping" },
  { value: "free_gift", label: "Free gift" },
  { value: "discount", label: "Discount" },
  { value: "store_credit", label: "Store credit" },
];

// The 4 message states, in order. `key` is the exact name the theme JS reads off cfg.messages.
const MSG_FIELDS = [
  { key: "below_t1", label: "Message — before Tier 1 is reached", placeholder: "Add {remaining} more for a free gift 🎁" },
  { key: "t1_reached", label: "Message — after Tier 1 (progressing to Tier 2)", placeholder: "🎁 Gift unlocked! Add {remaining} more for FREE shipping 🚚" },
  { key: "t2_reached", label: "Message — after Tier 2 (progressing to Tier 3)", placeholder: "🎁 Gift + 🚚 Shipping unlocked! Add {remaining} more for a 2nd free gift 🎁" },
  { key: "all_reached", label: "Message — when every tier is unlocked", placeholder: "🎉 Free Gift + Free Shipping + 2nd Gift — all unlocked!" },
];

type AdminTier = { thresholdRupees: number; label: string; type: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "bar_config")
    .maybeSingle();

  let cfg: any = {};
  try {
    cfg = data?.value ? JSON.parse(data.value) : {};
  } catch (e) {
    cfg = {};
  }

  const tiersRaw: any[] = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  const tiers: AdminTier[] = Array.from({ length: TIER_COUNT }, (_, i) => {
    const t = tiersRaw[i] ?? {};
    return {
      thresholdRupees: Math.round((parseInt(String(t.threshold_paise ?? 0), 10) || 0) / 100),
      label: String(t.label ?? ""),
      type: TYPES.some((o) => o.value === t.type) ? String(t.type) : "free_shipping",
    };
  });

  // messages is an object keyed by state; tolerate a legacy array by mapping it onto the keys in order.
  let msgsRaw: Record<string, any> = {};
  if (Array.isArray(cfg.messages)) {
    MSG_FIELDS.forEach((f, i) => {
      msgsRaw[f.key] = cfg.messages[i];
    });
  } else if (cfg.messages && typeof cfg.messages === "object") {
    msgsRaw = cfg.messages;
  }
  const messages: Record<string, string> = Object.fromEntries(
    MSG_FIELDS.map((f) => [f.key, String(msgsRaw[f.key] ?? "")]),
  );

  const enabled = cfg.enabled === true || cfg.enabled === "1";

  return { enabled, tiers, messages };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "save") {
    let tiersIn: any[] = [];
    let msgsIn: any = {};
    try {
      tiersIn = JSON.parse(String(form.get("tiers") ?? "[]"));
    } catch (e) {
      tiersIn = [];
    }
    try {
      msgsIn = JSON.parse(String(form.get("messages") ?? "{}"));
    } catch (e) {
      msgsIn = {};
    }

    const tiers = (Array.isArray(tiersIn) ? tiersIn : [])
      .map((t) => ({
        threshold_paise: Math.round((parseFloat(String(t.thresholdRupees ?? "0")) || 0) * 100),
        label: String(t.label ?? "").trim(),
        type: TYPES.some((o) => o.value === t.type) ? String(t.type) : "free_shipping",
      }))
      .filter((t) => t.threshold_paise > 0); // drop blank tier rows

    const messages: Record<string, string> = Object.fromEntries(
      MSG_FIELDS.map((f) => [f.key, String(msgsIn?.[f.key] ?? "")]),
    );

    const config = {
      enabled: String(form.get("enabled")) === "1",
      tiers,
      messages,
    };

    const { error } = await supabase
      .from("loyalty_config")
      .upsert([{ key: "bar_config", value: JSON.stringify(config) }]);
    if (error) throw error;
    return { ok: true };
  }

  return { ok: false };
};

const val = (id: string) => String((document.getElementById(id) as any)?.value ?? "");

export default function BarPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  const save = () => {
    const tiers = data.tiers.map((_, i) => ({
      thresholdRupees: val(`bar-threshold-${i}`),
      label: val(`bar-label-${i}`),
      type: val(`bar-type-${i}`) || "free_shipping",
    }));
    const messages = Object.fromEntries(MSG_FIELDS.map((f) => [f.key, val(`bar-msg-${f.key}`)]));
    fetcher.submit(
      {
        intent: "save",
        enabled: val("bar-enabled") || "0",
        tiers: JSON.stringify(tiers),
        messages: JSON.stringify(messages),
      },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Progress Bar">
      <s-section heading="Status">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            A cart progress bar that nudges shoppers toward spend thresholds. The storefront reads this config from
            the app proxy and shows the message for the next unreached tier, replacing <b>{"{remaining}"}</b> with
            the amount still needed.
          </s-paragraph>
          <s-select id="bar-enabled" label="Show the progress bar" value={data.enabled ? "1" : "0"}>
            <s-option value="1">Enabled</s-option>
            <s-option value="0">Disabled</s-option>
          </s-select>
        </s-stack>
      </s-section>

      <s-section heading="Tiers">
        <s-stack direction="block" gap="large">
          {data.tiers.map((t, i) => (
            <s-box key={i} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-heading>Tier {i + 1}</s-heading>
                <s-number-field
                  id={`bar-threshold-${i}`}
                  label="Threshold (₹)"
                  min={1}
                  value={String(t.thresholdRupees)}
                />
                <s-text-field id={`bar-label-${i}`} label="Reward label" value={t.label} placeholder="Free shipping" />
                <s-select id={`bar-type-${i}`} label="Reward type" value={t.type}>
                  {TYPES.map((o) => (
                    <s-option key={o.value} value={o.value}>
                      {o.label}
                    </s-option>
                  ))}
                </s-select>
              </s-stack>
            </s-box>
          ))}
          <s-paragraph>A tier with a blank or ₹0 threshold is ignored.</s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Messages">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Use <b>{"{remaining}"}</b> where the amount still needed to reach the next tier should appear (e.g.{" "}
            <i>Spend {"{remaining}"} more to unlock free shipping</i>).
          </s-paragraph>
          {MSG_FIELDS.map((f) => (
            <s-text-field key={f.key} id={`bar-msg-${f.key}`} label={f.label} value={data.messages[f.key] ?? ""} placeholder={f.placeholder} />
          ))}
        </s-stack>
      </s-section>

      <s-section>
        <s-button variant="primary" onClick={save}>
          Save
        </s-button>
      </s-section>
    </s-page>
  );
}
