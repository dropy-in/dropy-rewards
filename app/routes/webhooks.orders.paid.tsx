import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { earnFromOrder, creditStoreCreditFromOrder, logWebhook } from "../loyalty.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, webhookId, admin } = await authenticate.webhook(request);
  let ok = true;
  let msg = "";
  try {
    msg = await earnFromOrder(payload, admin);
    // Auto-credit 3% store credit (runs independently — doesn't block points)
    const scMsg = await creditStoreCreditFromOrder(payload, admin);
    msg += ` | ${scMsg}`;
  } catch (e) {
    ok = false;
    msg = String(e);
  }
  await logWebhook(topic, webhookId ?? null, String((payload as any)?.id ?? ""), ok, msg);
  if (!ok) throw new Response("error", { status: 500 });
  return new Response();
};