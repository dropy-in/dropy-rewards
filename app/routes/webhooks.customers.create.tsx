import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { signupPoints, logWebhook } from "../loyalty.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, webhookId } = await authenticate.webhook(request);
  let ok = true;
  let msg = "";
  try {
    msg = await signupPoints(payload);
  } catch (e) {
    ok = false;
    msg = String(e);
  }
  await logWebhook(topic, webhookId ?? null, String((payload as any)?.id ?? ""), ok, msg);
  if (!ok) throw new Response("error", { status: 500 });
  return new Response();
};