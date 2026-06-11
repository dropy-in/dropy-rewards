// app/card.server.ts — Dropy Credit Card claim engine (L4a)
// Cards = Shopify metaobjects: type "dropy_credit_card", handle "card-{16 digits}"
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type CardFields = {
  id: string; handle: string; card_number?: string;
  status?: string; credit_amount?: string; batch_id?: string;
};

async function gql(admin: any, query: string, variables: Record<string, any> = {}) {
  const res = await admin.graphql(query, { variables });
  const j = await res.json();
  if (j.errors) throw new Error("GQL: " + JSON.stringify(j.errors));
  return j.data;
}

export async function getCardByCode(admin: any, code: string): Promise<CardFields | null> {
  const data = await gql(admin, `#graphql
    query GetCard($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) { id handle fields { key value } }
    }`,
    { handle: { type: "dropy_credit_card", handle: `card-${code}` } }
  );
  const node = data.metaobjectByHandle;
  if (!node) return null;
  const f: any = {};
  for (const field of node.fields) f[field.key] = field.value;
  return { id: node.id, handle: node.handle, ...f };
}

export type ClaimResult =
  | { ok: true; amount: number; currency: string; newBalance: string; transactionId: string }
  | { ok: false; error: string; status?: string; message?: string; http: number };

export async function claimCard(admin: any, customerId: string, code: string): Promise<ClaimResult> {
  const card = await getCardByCode(admin, code);
  if (!card) return { ok: false, error: "NOT_FOUND", http: 404 };
  if (card.status !== "unused")
    return { ok: false, error: "NOT_REDEEMABLE", status: card.status, http: 409 };

  const amount = parseFloat(card.credit_amount || "0");
  if (!amount || amount <= 0)
    return { ok: false, error: "CREDIT_FAILED", message: "Card has no amount", http: 500 };

  const customerGid = `gid://shopify/Customer/${customerId}`;

  const info = await gql(admin, `#graphql
    query CardClaimInfo($id: ID!) {
      shop { currencyCode }
      customer(id: $id) { email firstName }
    }`, { id: customerGid });
  const currency = info.shop.currencyCode;
  const email = info.customer?.email || "";

  const up = await sb.from("loyalty_customers").upsert(
    { shopify_customer_id: customerId, email, first_name: info.customer?.firstName || null },
    { onConflict: "shopify_customer_id", ignoreDuplicates: true }
  );
  if (up.error) console.error("[card-claim] customer upsert", up.error.message);

  const ins = await sb.from("loyalty_ledger").insert({
    customer_id: customerId,
    type: "earn_card",
    points: 0,
    ref_id: `card-${code}`,
    note: `Dropy Card ₹${amount} · ${card.batch_id || "?"}`,
  }).select("id").single();

  if (ins.error) {
    if (ins.error.code === "23505")
      return { ok: false, error: "NOT_REDEEMABLE", status: "redeemed", http: 409 };
    return { ok: false, error: "INTERNAL_ERROR", message: ins.error.message, http: 500 };
  }
  const ledgerId = ins.data.id;

  let txn: any;
  try {
    const data = await gql(admin, `#graphql
      mutation CardCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction { id account { id balance { amount currencyCode } } }
          userErrors { field message code }
        }
      }`,
      { id: customerGid, creditInput: { creditAmount: { amount: String(amount), currencyCode: currency } } }
    );
    const ue = data.storeCreditAccountCredit.userErrors;
    if (ue?.length) throw new Error(JSON.stringify(ue));
    txn = data.storeCreditAccountCredit.storeCreditAccountTransaction;
  } catch (e: any) {
    await sb.from("loyalty_ledger").delete().eq("id", ledgerId);
    console.error("[card-claim] credit failed", e?.message || e);
    return { ok: false, error: "CREDIT_FAILED", message: "Could not add the credit", http: 500 };
  }

  try {
    const upd = await gql(admin, `#graphql
      mutation MarkRedeemed($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
          metaobject { id }
          userErrors { field message code }
        }
      }`,
      { id: card.id, fields: [
          { key: "status", value: "redeemed" },
          { key: "redeemed_at", value: new Date().toISOString() },
          { key: "redeemed_by_customer", value: customerGid },
          { key: "redeemed_by_email", value: email },
          { key: "store_credit_account_id", value: txn.id },
      ]}
    );
    if (upd.metaobjectUpdate.userErrors?.length)
      console.error("[card-claim] metaobject userErrors", JSON.stringify(upd.metaobjectUpdate.userErrors));
  } catch (e: any) {
    console.error("[card-claim] metaobject update failed (credit already given)", e?.message || e);
  }

  const red = await sb.from("loyalty_redemptions").insert({
    customer_id: customerId,
    ledger_id: ledgerId,
    reward_type: "store_credit",
    points_spent: 0,
    value_paise: Math.round(amount * 100),
    shopify_ref: `CARD-${code.slice(-4)}`,
    title: `₹${amount} · Dropy Card`,
  });
  if (red.error) console.error("[card-claim] redemptions insert", red.error.message);

  return { ok: true, amount, currency, newBalance: txn.account.balance.amount, transactionId: txn.id };
}