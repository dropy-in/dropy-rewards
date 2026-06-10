import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getConfig,
  updateConfig,
  setConfigKey,
  listPrograms,
  createProgram,
  setProgramActive,
  deleteProgram,
} from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [config, programs] = await Promise.all([getConfig(), listPrograms()]);
  return { config, programs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const num = (k: string) => parseFloat(String(form.get(k) ?? "0")) || 0;

  if (intent === "save_place_order") {
    await updateConfig({
      earn_amount_rupees: String(form.get("earn_amount_rupees")),
      earn_points: String(form.get("earn_points")),
      pending_days: String(form.get("pending_days")),
    });
  } else if (intent === "save_signup") {
    await updateConfig({ signup_points: String(form.get("signup_points")) });
  } else if (intent === "save_point_value") {
    await updateConfig({ point_value_paise: String(form.get("point_value_paise")) });
  } else if (intent === "toggle_config") {
    await setConfigKey(String(form.get("key")), String(form.get("value")));
  } else if (intent === "create_program") {
    await createProgram({
      type: String(form.get("type")),
      name: String(form.get("name") || "Untitled program"),
      discount_kind: form.get("discount_kind") ? String(form.get("discount_kind")) : null,
      discount_value: form.get("discount_value") ? num("discount_value") : null,
      points_required: Math.round(num("points_required")),
      min_order_amount: form.get("min_order_amount") ? num("min_order_amount") : 0,
      product_id: form.get("product_id") ? String(form.get("product_id")) : null,
      product_title: form.get("product_title") ? String(form.get("product_title")) : null,
    });
  } else if (intent === "toggle_program") {
    await setProgramActive(Number(form.get("id")), String(form.get("active")) === "1");
  } else if (intent === "delete_program") {
    await deleteProgram(Number(form.get("id")));
  }
  return { ok: true, intent };
};

const val = (id: string) => String((document.getElementById(id) as any)?.value ?? "");
const closeModal = (id: string) => (document.getElementById(id) as any)?.click?.();

const TYPE_LABEL: Record<string, string> = {
  discount: "Discount Program",
  free_gift: "Free Gift Program",
  free_shipping: "Free Shipping Program",
};

export default function Program() {
  const { config, programs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [tab, setTab] = useState<"earning" | "redeeming">("earning");
  const [filter, setFilter] = useState<string>("all");
  const [gift, setGift] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  const submit = (payload: Record<string, string>) => fetcher.submit(payload, { method: "POST" });

  const pickProduct = async () => {
    const selected = await (shopify as any).resourcePicker({ type: "product", multiple: false });
    const p = selected?.[0] ?? selected?.selection?.[0];
    if (p) setGift({ id: String(p.id), title: String(p.title) });
  };

  const shown = programs.filter((p: any) => filter === "all" || p.type === filter);

  return (
    <s-page heading="Loyalty Program">
      {/* tabs */}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-button variant={tab === "earning" ? "primary" : "secondary"} onClick={() => setTab("earning")}>
            Earning program
          </s-button>
          <s-button variant={tab === "redeeming" ? "primary" : "secondary"} onClick={() => setTab("redeeming")}>
            Redeeming program
          </s-button>
        </s-stack>
      </s-section>

      {tab === "earning" && (
        <>
          <s-section heading="Place Order">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Customers earn points every time they place a paid order. Current rule: ₹{config.earnAmount} →{" "}
                {config.earnPoints} pts · pending {config.pendingDays} days · floor rounding.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-badge tone={config.placeOrderEnabled ? "success" : undefined}>
                  {config.placeOrderEnabled ? "On" : "Off"}
                </s-badge>
                <s-button commandFor="po-modal" command="--show">Edit</s-button>
                <s-button
                  variant="tertiary"
                  onClick={() =>
                    submit({ intent: "toggle_config", key: "place_order_enabled", value: config.placeOrderEnabled ? "0" : "1" })
                  }
                >
                  {config.placeOrderEnabled ? "Turn off" : "Turn on"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Sign Up">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                One-time bonus when a customer creates an account: {config.signupPoints} pts, available instantly.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-badge tone={config.signupEnabled ? "success" : undefined}>
                  {config.signupEnabled ? "On" : "Off"}
                </s-badge>
                <s-button commandFor="su-modal" command="--show">Edit</s-button>
                <s-button
                  variant="tertiary"
                  onClick={() =>
                    submit({ intent: "toggle_config", key: "signup_enabled", value: config.signupEnabled ? "0" : "1" })
                  }
                >
                  {config.signupEnabled ? "Turn off" : "Turn on"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Point value">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {config.pointValuePaise} paise per point (₹{(config.pointValuePaise / 100).toFixed(2)}). Used at
                redemption — ₹100 spend → {config.earnPoints} pts → ₹
                {((config.earnPoints * config.pointValuePaise) / 100).toFixed(2)} back.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button commandFor="pv-modal" command="--show">Edit</s-button>
              </s-stack>
            </s-stack>
          </s-section>

          {/* Place Order modal */}
          <s-modal id="po-modal" heading="Place order">
            <s-stack direction="block" gap="base">
              <s-number-field id="po-amount" label="Amount spent (₹)" min={1} value={String(config.earnAmount)} />
              <s-number-field id="po-points" label="Points earned" min={0} value={String(config.earnPoints)} />
              <s-number-field id="po-pending" label="Pending points duration (days)" min={0} value={String(config.pendingDays)} />
              <s-paragraph>Rounding rule: Floor (4.7 → 4)</s-paragraph>
            </s-stack>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                submit({
                  intent: "save_place_order",
                  earn_amount_rupees: val("po-amount"),
                  earn_points: val("po-points"),
                  pending_days: val("po-pending"),
                });
                closeModal("po-close");
              }}
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" commandFor="po-modal" command="--hide">Discard</s-button>
            <span style={{ display: "none" }}><s-button id="po-close" commandFor="po-modal" command="--hide">x</s-button></span>
          </s-modal>

          {/* Sign Up modal */}
          <s-modal id="su-modal" heading="Sign Up">
            <s-number-field id="su-points" label="Points earned" min={0} value={String(config.signupPoints)} />
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                submit({ intent: "save_signup", signup_points: val("su-points") });
                closeModal("su-close");
              }}
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" commandFor="su-modal" command="--hide">Discard</s-button>
            <span style={{ display: "none" }}><s-button id="su-close" commandFor="su-modal" command="--hide">x</s-button></span>
          </s-modal>

          {/* Point value modal */}
          <s-modal id="pv-modal" heading="Point value">
            <s-number-field id="pv-paise" label="Value per point (paise)" min={1} value={String(config.pointValuePaise)} />
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                submit({ intent: "save_point_value", point_value_paise: val("pv-paise") });
                closeModal("pv-close");
              }}
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" commandFor="pv-modal" command="--hide">Discard</s-button>
            <span style={{ display: "none" }}><s-button id="pv-close" commandFor="pv-modal" command="--hide">x</s-button></span>
          </s-modal>
        </>
      )}

      {tab === "redeeming" && (
        <>
          <s-section heading="Discount Program">
            <s-stack direction="block" gap="base">
              <s-paragraph>Create discount programs that let customers redeem points for discounts.</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button commandFor="dp-modal" command="--show">Create</s-button>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Free Gift Program">
            <s-stack direction="block" gap="base">
              <s-paragraph>Let customers exchange points for free products.</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button commandFor="fg-modal" command="--show">Create</s-button>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Free Shipping Program">
            <s-stack direction="block" gap="base">
              <s-paragraph>Let customers unlock free shipping with points.</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button commandFor="fs-modal" command="--show">Create</s-button>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Programs">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                {["all", "discount", "free_gift", "free_shipping"].map((f) => (
                  <s-button key={f} variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : TYPE_LABEL[f]}
                  </s-button>
                ))}
              </s-stack>
              {shown.length === 0 ? (
                <s-paragraph>No programs</s-paragraph>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Name</s-table-header>
                    <s-table-header>Type</s-table-header>
                    <s-table-header>Details</s-table-header>
                    <s-table-header format="numeric">Points</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {shown.map((p: any) => (
                      <s-table-row key={p.id}>
                        <s-table-cell>{p.name}</s-table-cell>
                        <s-table-cell><s-badge tone="info">{TYPE_LABEL[p.type]}</s-badge></s-table-cell>
                        <s-table-cell>
                          {p.type === "discount" &&
                            `${p.discount_kind === "percentage" ? `${p.discount_value}%` : `₹${p.discount_value}`} off · min ₹${p.min_order_amount}`}
                          {p.type === "free_gift" && `${p.product_title ?? "—"} · min ₹${p.min_order_amount}`}
                          {p.type === "free_shipping" && "Free shipping"}
                        </s-table-cell>
                        <s-table-cell>{p.points_required}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={p.active ? "success" : undefined}>{p.active ? "Active" : "Off"}</s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="base">
                            <s-button
                              variant="tertiary"
                              onClick={() => submit({ intent: "toggle_program", id: String(p.id), active: p.active ? "0" : "1" })}
                            >
                              {p.active ? "Turn off" : "Turn on"}
                            </s-button>
                            <s-button
                              variant="tertiary"
                              tone="critical"
                              onClick={() => submit({ intent: "delete_program", id: String(p.id) })}
                            >
                              Delete
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          </s-section>

          {/* Discount modal */}
          <s-modal id="dp-modal" heading="Discount program">
            <s-stack direction="block" gap="base">
              <s-text-field id="dp-name" label="Program name" placeholder="Discount Program" />
              <s-select id="dp-kind" label="Discount type">
                <s-option value="amount">Discount amount (₹)</s-option>
                <s-option value="percentage">Percentage (%)</s-option>
              </s-select>
              <s-number-field id="dp-value" label="Discount amount" min={1} />
              <s-number-field id="dp-points" label="Redeem points" min={1} />
              <s-number-field id="dp-min" label="Minimum order amount (₹)" min={0} value="0" />
            </s-stack>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                submit({
                  intent: "create_program", type: "discount",
                  name: val("dp-name") || "Discount Program",
                  discount_kind: val("dp-kind") || "amount",
                  discount_value: val("dp-value"),
                  points_required: val("dp-points"),
                  min_order_amount: val("dp-min"),
                });
                closeModal("dp-close");
              }}
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" commandFor="dp-modal" command="--hide">Discard</s-button>
            <span style={{ display: "none" }}><s-button id="dp-close" commandFor="dp-modal" command="--hide">x</s-button></span>
          </s-modal>

          {/* Free gift modal */}
          <s-modal id="fg-modal" heading="Free Gift Program">
            <s-stack direction="block" gap="base">
              <s-text-field id="fg-name" label="Program name" placeholder="Free Gift Program" />
              <s-stack direction="inline" gap="base">
                <s-button onClick={pickProduct}>Select product</s-button>
                <s-text>{gift ? gift.title : "No product selected"}</s-text>
              </s-stack>
              <s-number-field id="fg-points" label="Points required to redeem" min={1} />
              <s-number-field id="fg-min" label="Minimum order amount (₹)" min={0} value="0" />
            </s-stack>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                if (!gift) {
                  shopify.toast.show("Select a product first", { isError: true });
                  return;
                }
                submit({
                  intent: "create_program", type: "free_gift",
                  name: val("fg-name") || "Free Gift Program",
                  points_required: val("fg-points"),
                  min_order_amount: val("fg-min"),
                  product_id: gift.id, product_title: gift.title,
                });
                setGift(null);
                closeModal("fg-close");
              }}
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" commandFor="fg-modal" command="--hide">Discard</s-button>
            <span style={{ display: "none" }}><s-button id="fg-close" commandFor="fg-modal" command="--hide">x</s-button></span>
          </s-modal>

          {/* Free shipping modal */}
          <s-modal id="fs-modal" heading="Free Shipping Program">
            <s-stack direction="block" gap="base">
              <s-text-field id="fs-name" label="Program name" placeholder="Free Shipping Program" />
              <s-number-field id="fs-points" label="Minimum points required" min={1} />
            </s-stack>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                submit({
                  intent: "create_program", type: "free_shipping",
                  name: val("fs-name") || "Free Shipping Program",
                  points_required: val("fs-points"),
                  min_order_amount: "0",
                });
                closeModal("fs-close");
              }}
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" commandFor="fs-modal" command="--hide">Discard</s-button>
            <span style={{ display: "none" }}><s-button id="fs-close" commandFor="fs-modal" command="--hide">x</s-button></span>
          </s-modal>
        </>
      )}
    </s-page>
  );
}