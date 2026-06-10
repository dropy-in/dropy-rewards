import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetrics, getConfig, recentWebhooks } from "../loyalty.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [metrics, config, hooks] = await Promise.all([getMetrics(), getConfig(), recentWebhooks()]);
  return { metrics, config, hooks };
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-IN");
const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        <s-text>{label}</s-text>
        <s-heading>{String(value)}</s-heading>
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const { metrics, config, hooks } = useLoaderData<typeof loader>();
  const disbursed = metrics.points_order + metrics.points_signup;
  const valueIssued = (disbursed * config.pointValuePaise) / 100;

  return (
    <s-page heading="Dashboard">
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
          <Metric label="Loyalty customers" value={fmt(metrics.customers)} />
          <Metric label="Points available" value={fmt(metrics.points_available)} />
          <Metric label="Points pending" value={fmt(metrics.points_pending)} />
          <Metric label="Points redeemed" value={fmt(metrics.points_redeemed)} />
        </s-grid>
      </s-section>

      <s-section heading="Points disbursed">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
          <Metric label="Place Order" value={fmt(metrics.points_order)} />
          <Metric label="Sign Up" value={fmt(metrics.points_signup)} />
          <Metric label="Liability (₹ value issued)" value={`₹${fmt(valueIssued)}`} />
        </s-grid>
      </s-section>

      <s-section heading="Recent activity">
        {hooks.length === 0 ? (
          <s-paragraph>No webhook activity yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Topic</s-table-header>
              <s-table-header>Ref</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Message</s-table-header>
              <s-table-header>Time</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {hooks.map((h: any) => (
                <s-table-row key={h.id}>
                  <s-table-cell>{h.topic}</s-table-cell>
                  <s-table-cell>{h.ref}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={h.ok ? "success" : "critical"}>{h.ok ? "ok" : "error"}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{h.message}</s-table-cell>
                  <s-table-cell>{dt(h.created_at)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}