import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConfig, updateConfig } from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { config: await getConfig() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  await updateConfig(Object.fromEntries(form) as Record<string, string>);
  return { ok: true };
};

export default function Program() {
  const { config } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Program saved");
  }, [fetcher.data, shopify]);

  const save = () => {
    const v = (id: string) => String((document.getElementById(id) as any)?.value ?? "");
    fetcher.submit(
      {
        earn_amount_rupees: v("cfg-earn-amount"),
        earn_points: v("cfg-earn-points"),
        pending_days: v("cfg-pending-days"),
        signup_points: v("cfg-signup-points"),
        point_value_paise: v("cfg-point-value"),
      },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Loyalty Program">
      <s-button slot="primary-action" variant="primary" onClick={save} {...(saving ? { loading: true } : {})}>
        Save
      </s-button>

      <s-section heading="Earning — Place Order">
        <s-paragraph>
          Customers earn points every time they place a paid order. Rounding: floor (4.7 → 4).
        </s-paragraph>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <s-number-field id="cfg-earn-amount" label="Amount spent (₹)" min="1" value={String(config.earnAmount)} />
          <s-number-field id="cfg-earn-points" label="Points earned" min="0" value={String(config.earnPoints)} />
          <s-number-field
            id="cfg-pending-days"
            label="Pending duration (days)"
            details="Points unlock after this many days — covers your 7-day return window."
            min="0"
            value={String(config.pendingDays)}
          />
        </s-grid>
      </s-section>

      <s-section heading="Earning — Sign Up">
        <s-paragraph>One-time bonus when a customer creates an account. Available instantly.</s-paragraph>
        <s-number-field id="cfg-signup-points" label="Points earned" min="0" value={String(config.signupPoints)} />
      </s-section>

      <s-section heading="Point value">
        <s-paragraph>
          Used at redemption. 30 paise/point means ₹100 spend → 10 pts → ₹3 back (3%, same as the old
          cashback Flow).
        </s-paragraph>
        <s-number-field id="cfg-point-value" label="Value per point (paise)" min="1" value={String(config.pointValuePaise)} />
      </s-section>
    </s-page>
  );
}