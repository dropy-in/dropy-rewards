import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

// Config stored in loyalty_config row (key "exit_config") as JSON.
// The storefront reads it via proxy.exit.config.tsx.
//
// Shape:
// {
//   popup: {
//     enabled, idle_desktop, idle_mobile, min_pages, min_seconds,
//     cooldown_hours, dismiss_days, max_lifetime,
//     tiers: [ { heading, body, discount } ],  // escalation tiers (up to 3)
//     cta_text, show_gift_reminder, gift_reminder_text
//   },
//   timer: {
//     enabled, duration_seconds, label, expiry_message, expiry_cta
//   }
// }

const DEFAULTS = {
  popup: {
    enabled: false,
    idle_desktop: 30,
    idle_mobile: 20,
    min_pages: 2,
    min_seconds: 30,
    cooldown_hours: 72,
    dismiss_days: 7,
    max_lifetime: 3,
    tiers: [
      { heading: "Your cart is waiting! 🛒", body: "You've got great items in your cart.", discount: "" },
      { heading: "Still thinking? 🤔", body: "Use FIRST200 for ₹200 off your first order!", discount: "FIRST200" },
      { heading: "Last chance! ⏰", body: "Your cart will expire soon — complete your order now.", discount: "" },
    ],
    cta_text: "Complete My Order",
    show_gift_reminder: true,
    gift_reminder_text: "FREE CeraVe included with your order! 🎁",
  },
  timer: {
    enabled: false,
    duration_seconds: 900,
    label: "🔒 Items reserved for you",
    expiry_message: "⚠️ High demand — items may sell out!",
    expiry_cta: "Checkout Now",
  },
};

const TIER_COUNT = 3;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "exit_config")
    .maybeSingle();

  let cfg: any = {};
  try {
    cfg = data?.value ? JSON.parse(data.value) : {};
  } catch (e) {
    cfg = {};
  }

  const p = cfg.popup ?? {};
  const t = cfg.timer ?? {};

  const popup = {
    enabled: p.enabled === true,
    idle_desktop: parseInt(String(p.idle_desktop ?? DEFAULTS.popup.idle_desktop), 10),
    idle_mobile: parseInt(String(p.idle_mobile ?? DEFAULTS.popup.idle_mobile), 10),
    min_pages: parseInt(String(p.min_pages ?? DEFAULTS.popup.min_pages), 10),
    min_seconds: parseInt(String(p.min_seconds ?? DEFAULTS.popup.min_seconds), 10),
    cooldown_hours: parseInt(String(p.cooldown_hours ?? DEFAULTS.popup.cooldown_hours), 10),
    dismiss_days: parseInt(String(p.dismiss_days ?? DEFAULTS.popup.dismiss_days), 10),
    max_lifetime: parseInt(String(p.max_lifetime ?? DEFAULTS.popup.max_lifetime), 10),
    tiers: Array.from({ length: TIER_COUNT }, (_, i) => {
      const tier = Array.isArray(p.tiers) ? p.tiers[i] ?? {} : {};
      const def = DEFAULTS.popup.tiers[i] ?? {};
      return {
        heading: String(tier.heading ?? def.heading ?? ""),
        body: String(tier.body ?? def.body ?? ""),
        discount: String(tier.discount ?? def.discount ?? ""),
      };
    }),
    cta_text: String(p.cta_text ?? DEFAULTS.popup.cta_text),
    show_gift_reminder: p.show_gift_reminder !== false,
    gift_reminder_text: String(p.gift_reminder_text ?? DEFAULTS.popup.gift_reminder_text),
  };

  const timer = {
    enabled: t.enabled === true,
    duration_seconds: parseInt(String(t.duration_seconds ?? DEFAULTS.timer.duration_seconds), 10),
    label: String(t.label ?? DEFAULTS.timer.label),
    expiry_message: String(t.expiry_message ?? DEFAULTS.timer.expiry_message),
    expiry_cta: String(t.expiry_cta ?? DEFAULTS.timer.expiry_cta),
  };

  return { popup, timer };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "save") {
    let popupIn: any = {};
    let timerIn: any = {};
    try { popupIn = JSON.parse(String(form.get("popup") ?? "{}")); } catch (e) { popupIn = {}; }
    try { timerIn = JSON.parse(String(form.get("timer") ?? "{}")); } catch (e) { timerIn = {}; }

    const config = {
      popup: {
        enabled: popupIn.enabled === true || popupIn.enabled === "1",
        idle_desktop: Math.max(5, parseInt(String(popupIn.idle_desktop ?? 30), 10) || 30),
        idle_mobile: Math.max(5, parseInt(String(popupIn.idle_mobile ?? 20), 10) || 20),
        min_pages: Math.max(1, parseInt(String(popupIn.min_pages ?? 2), 10) || 2),
        min_seconds: Math.max(5, parseInt(String(popupIn.min_seconds ?? 30), 10) || 30),
        cooldown_hours: Math.max(1, parseInt(String(popupIn.cooldown_hours ?? 72), 10) || 72),
        dismiss_days: Math.max(1, parseInt(String(popupIn.dismiss_days ?? 7), 10) || 7),
        max_lifetime: Math.max(1, parseInt(String(popupIn.max_lifetime ?? 3), 10) || 3),
        tiers: (Array.isArray(popupIn.tiers) ? popupIn.tiers : []).slice(0, TIER_COUNT).map((t: any) => ({
          heading: String(t?.heading ?? "").trim(),
          body: String(t?.body ?? "").trim(),
          discount: String(t?.discount ?? "").trim(),
        })),
        cta_text: String(popupIn.cta_text ?? "Complete My Order").trim(),
        show_gift_reminder: popupIn.show_gift_reminder === true || popupIn.show_gift_reminder === "1",
        gift_reminder_text: String(popupIn.gift_reminder_text ?? "").trim(),
      },
      timer: {
        enabled: timerIn.enabled === true || timerIn.enabled === "1",
        duration_seconds: Math.max(60, parseInt(String(timerIn.duration_seconds ?? 900), 10) || 900),
        label: String(timerIn.label ?? "").trim(),
        expiry_message: String(timerIn.expiry_message ?? "").trim(),
        expiry_cta: String(timerIn.expiry_cta ?? "").trim(),
      },
    };

    const { error } = await supabase
      .from("loyalty_config")
      .upsert([{ key: "exit_config", value: JSON.stringify(config) }]);
    if (error) throw error;
    return { ok: true };
  }

  return { ok: false };
};

const val = (id: string) => String((document.getElementById(id) as any)?.value ?? "");
const chk = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value === "1";

export default function ExitPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  const save = () => {
    const tiers = data.popup.tiers.map((_, i) => ({
      heading: val(`exit-tier-heading-${i}`),
      body: val(`exit-tier-body-${i}`),
      discount: val(`exit-tier-discount-${i}`),
    }));

    const popup = {
      enabled: val("exit-popup-enabled") === "1",
      idle_desktop: val("exit-idle-desktop"),
      idle_mobile: val("exit-idle-mobile"),
      min_pages: val("exit-min-pages"),
      min_seconds: val("exit-min-seconds"),
      cooldown_hours: val("exit-cooldown-hours"),
      dismiss_days: val("exit-dismiss-days"),
      max_lifetime: val("exit-max-lifetime"),
      tiers,
      cta_text: val("exit-cta-text"),
      show_gift_reminder: val("exit-gift-reminder") === "1",
      gift_reminder_text: val("exit-gift-reminder-text"),
    };

    const timer = {
      enabled: val("exit-timer-enabled") === "1",
      duration_seconds: val("exit-timer-duration"),
      label: val("exit-timer-label"),
      expiry_message: val("exit-timer-expiry-msg"),
      expiry_cta: val("exit-timer-expiry-cta"),
    };

    fetcher.submit(
      { intent: "save", popup: JSON.stringify(popup), timer: JSON.stringify(timer) },
      { method: "POST" },
    );
  };

  const p = data.popup;
  const t = data.timer;

  return (
    <s-page heading="Exit Intent & Cart Timer">
      {/* ─── POPUP SECTION ─── */}
      <s-section heading="Exit Intent Popup">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Shows a popup when a customer is about to abandon their cart — on desktop when the
            mouse leaves the viewport, on mobile after idle time or a tab switch. Escalates the
            message across up to 3 lifetime shows, then stops forever.
          </s-paragraph>
          <s-select id="exit-popup-enabled" label="Enable exit popup" value={p.enabled ? "1" : "0"}>
            <s-option value="1">Enabled</s-option>
            <s-option value="0">Disabled</s-option>
          </s-select>
        </s-stack>
      </s-section>

      <s-section heading="Trigger Thresholds">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Fine-tune when the popup fires. Higher values = less aggressive = less annoying.
          </s-paragraph>
          <s-inline-grid columns="2" gap="base">
            <s-number-field id="exit-idle-desktop" label="Desktop idle timeout (seconds)" min={5} value={String(p.idle_desktop)} />
            <s-number-field id="exit-idle-mobile" label="Mobile idle timeout (seconds)" min={5} value={String(p.idle_mobile)} />
            <s-number-field id="exit-min-pages" label="Min pages visited before trigger" min={1} value={String(p.min_pages)} />
            <s-number-field id="exit-min-seconds" label="Min seconds on page before trigger" min={5} value={String(p.min_seconds)} />
          </s-inline-grid>
        </s-stack>
      </s-section>

      <s-section heading="Frequency Caps (Anti-Annoyance)">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Controls how often a customer sees the popup. After the lifetime cap, it never shows again (30-day cookie).
          </s-paragraph>
          <s-inline-grid columns="3" gap="base">
            <s-number-field id="exit-cooldown-hours" label="Cooldown between shows (hours)" min={1} value={String(p.cooldown_hours)} />
            <s-number-field id="exit-dismiss-days" label="Cooldown after ✕ dismiss (days)" min={1} value={String(p.dismiss_days)} />
            <s-number-field id="exit-max-lifetime" label="Max lifetime shows" min={1} value={String(p.max_lifetime)} />
          </s-inline-grid>
        </s-stack>
      </s-section>

      <s-section heading="Popup Escalation Tiers">
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Each show can have different copy. Show #1 is a gentle reminder, show #2 surfaces a
            discount code, show #3 adds urgency. After the max, it stops permanently.
          </s-paragraph>
          {p.tiers.map((tier, i) => (
            <s-box key={i} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-heading>Show #{i + 1}</s-heading>
                <s-text-field id={`exit-tier-heading-${i}`} label="Heading" value={tier.heading} />
                <s-text-field id={`exit-tier-body-${i}`} label="Body text" value={tier.body} />
                <s-text-field id={`exit-tier-discount-${i}`} label="Discount code to show (optional)" value={tier.discount} placeholder="FIRST200" />
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Popup Content">
        <s-stack direction="block" gap="base">
          <s-text-field id="exit-cta-text" label="CTA button text" value={p.cta_text} />
          <s-select id="exit-gift-reminder" label="Show free gift reminder" value={p.show_gift_reminder ? "1" : "0"}>
            <s-option value="1">Yes</s-option>
            <s-option value="0">No</s-option>
          </s-select>
          <s-text-field id="exit-gift-reminder-text" label="Gift reminder text" value={p.gift_reminder_text} />
        </s-stack>
      </s-section>

      {/* ─── TIMER SECTION ─── */}
      <s-section heading="Cart Reserved Timer">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Displays a countdown on the cart page / cart drawer, framed as "items reserved for you."
            Creates urgency without actually clearing the cart — when the timer hits zero it shows a
            soft "high demand" message and resets silently on any interaction.
          </s-paragraph>
          <s-select id="exit-timer-enabled" label="Enable cart timer" value={t.enabled ? "1" : "0"}>
            <s-option value="1">Enabled</s-option>
            <s-option value="0">Disabled</s-option>
          </s-select>
          <s-number-field id="exit-timer-duration" label="Timer duration (seconds)" min={60} value={String(t.duration_seconds)} />
          <s-text-field id="exit-timer-label" label="Timer label" value={t.label} />
          <s-text-field id="exit-timer-expiry-msg" label="Message when timer expires" value={t.expiry_message} />
          <s-text-field id="exit-timer-expiry-cta" label="CTA after expiry" value={t.expiry_cta} />
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
