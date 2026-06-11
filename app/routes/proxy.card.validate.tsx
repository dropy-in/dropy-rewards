import { authenticate } from "../shopify.server";
import { getCardByCode } from "../card.server";

export const action = async ({ request }: { request: Request }) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return Response.json({ error: "INTERNAL_ERROR", message: "App not ready" }, { status: 500 });

  const body = await request.json().catch(() => null);
  const code = String(body?.code || "").replace(/\s/g, "");
  if (!/^\d{16}$/.test(code))
    return Response.json({ error: "INVALID_FORMAT", message: "Code must be 16 digits" }, { status: 400 });

  const card = await getCardByCode(admin, code);
  if (!card) return Response.json({ error: "NOT_FOUND", message: "Card not found" }, { status: 404 });
  if (card.status !== "unused")
    return Response.json({ error: "NOT_REDEEMABLE", status: card.status }, { status: 409 });

  return Response.json({ valid: true, amount: parseFloat(card.credit_amount || "0"), currency: "INR", batch_id: card.batch_id });
};