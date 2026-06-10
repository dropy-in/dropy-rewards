 import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redeemProgram } from "../loyalty.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const cid = url.searchParams.get("logged_in_customer_id") || "";
  if (!cid) return Response.json({ ok: false, error: "Please sign in" }, { status: 401 });
  if (!admin) return Response.json({ ok: false, error: "App not ready" }, { status: 500 });

  const form = await request.formData();
  const programId = Number(form.get("program_id"));
  if (!programId) return Response.json({ ok: false, error: "Bad request" }, { status: 400 });

  try {
    const result = await redeemProgram(admin, cid, programId);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return Response.json({ ok: false, error: "Server error" }, { status: 500 });
  }
};