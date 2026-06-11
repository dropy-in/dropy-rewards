import { authenticate } from "../shopify.server";
import { claimCard } from "../card.server";

export const action = async ({ request }: { request: Request }) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return Response.json({ error: "INTERNAL_ERROR", message: "App not ready" }, { status: 500 });

  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
  if (!customerId)
    return Response.json({ error: "LOGIN_REQUIRED", message: "Please log in to redeem." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const code = String(body?.code || "").replace(/\s/g, "");
  if (!/^\d{16}$/.test(code))
    return Response.json({ error: "INVALID_FORMAT", message: "Code must be 16 digits" }, { status: 400 });

  const result = await claimCard(admin, customerId, code);
  if (!result.ok)
    return Response.json({ error: result.error, status: result.status, message: result.message }, { status: result.http });

  return Response.json({
    success: true,
    amount: result.amount,
    currency: result.currency,
    new_balance: result.newBalance,
    transaction_id: result.transactionId,
  });
};