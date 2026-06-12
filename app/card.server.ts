// app/card.server.ts — Dropy Credit Card claim engine (L4a)
// Cards = Shopify metaobjects: type "dropy_credit_card", handle "card-{16 digits}"
//
// Two kinds of card share the metaobject type, discriminated by the `card_type` field
// (added by dropy-cards-admin):
//   • legacy single-use card  (card_type absent / != "campaign") — one number, one claim,
//     guarded by the metaobject status flip → "redeemed".
//   • campaign card           (card_type == "campaign")          — one number printed on N
//     package inserts, pooled claims (max_claims), per-customer once, order-gated. The pool
//     ledger lives in Supabase Postgres (campaign_cards / card_claims) so concurrent claims
//     are race-safe; the metaobject only mirrors claim_count for the admin's benefit.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type CardFields = {
  id: string; handle: string; card_number?: string;
  status?: string; credit_amount?: string; batch_id?: string;
  // campaign fields (created by dropy-cards-admin)
  card_type?: string; max_claims?: string; claim_count?: string; expires_at?: string;
};

async function gql(admin: any, query: string, variables: Record<string, any> = {}) {
  const res = await admin.graphql(query, { variables });
  const j = await res.json();
  if (j.errors) throw new Error("GQL: " + JSON.stringify(j.errors));
  return j.data;
}

// Best-effort release of a campaign reservation row. Never throws — a failure here must not
// crash the claim handler; it only leaves a traceable log so an orphan pending row (which would
// block the customer's retry on the PK) can be reconciled.
async function dropReservation(db: any, code: string, customerId: string) {
  try {
    const del = await db.from("card_claims").delete().eq("card_number", code).eq("customer_id", customerId);
    if (del?.error) console.error("[campaign-claim] drop reservation", del.error.message);
  } catch (e: any) {
    console.error("[campaign-claim] drop reservation threw", e?.message || e);
  }
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

// `db` is injectable so the claim engine can be exercised against a fake Postgres in tests;
// it defaults to the real Supabase service-role client in production.
export async function claimCard(admin: any, customerId: string, code: string, db: any = sb): Promise<ClaimResult> {
  const card = await getCardByCode(admin, code);
  if (!card) return { ok: false, error: "NOT_FOUND", http: 404 };

  // Campaign cards take the pooled, race-safe path. Everything below this branch is the
  // legacy single-use path, unchanged.
  if (card.card_type === "campaign") return claimCampaignCard(admin, customerId, code, card, db);

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

  const up = await db.from("loyalty_customers").upsert(
    { shopify_customer_id: customerId, email, first_name: info.customer?.firstName || null },
    { onConflict: "shopify_customer_id", ignoreDuplicates: true }
  );
  if (up.error) console.error("[card-claim] customer upsert", up.error.message);

  const ins = await db.from("loyalty_ledger").insert({
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
    await db.from("loyalty_ledger").delete().eq("id", ledgerId);
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

  const red = await db.from("loyalty_redemptions").insert({
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

// ---------- campaign cards: pooled, reservation-first, order-gated ----------

// The claim is ordered so that nothing irreversible happens before the two race guards have
// committed: (1) the card_claims PK reservation (per-customer-once), then (2) the RPC pool
// slot (max_claims). Store credit is only issued once a slot is held; any later failure rolls
// both guards back so the customer can retry, and the slot is freed for someone else.
async function claimCampaignCard(
  admin: any, customerId: string, code: string, card: CardFields, db: any,
): Promise<ClaimResult> {
  const amount = Math.round(parseFloat(card.credit_amount || "0"));
  const maxClaims = parseInt(card.max_claims || "0", 10);
  if (!amount || amount <= 0)
    return { ok: false, error: "CREDIT_FAILED", message: "Card has no amount", http: 500 };
  // A missing/0/NaN max_claims would seed a card that can never be claimed; fail loudly instead
  // of letting the first claimant get a misleading "fully claimed".
  if (!maxClaims || maxClaims <= 0)
    return { ok: false, error: "CREDIT_FAILED", message: "Card is misconfigured", http: 500 };

  // (a) Lazy registration — seed the pool row from the metaobject on first sighting. Uses
  // INSERT … ON CONFLICT DO NOTHING (ignoreDuplicates) so a concurrent first-claim, or any
  // later claim, never clobbers the authoritative claim_count. amount / max_claims are locked
  // in at first claim — the DB row, not the metaobject, is the source of truth for the pool
  // from here on (later metaobject edits to amount/max_claims do not retroactively apply).
  const seed = await db.from("campaign_cards").upsert(
    {
      card_number: code,
      metaobject_id: card.id,
      amount,
      max_claims: maxClaims,
      expires_at: card.expires_at || null,
      status: "active",
    },
    { onConflict: "card_number", ignoreDuplicates: true },
  );
  if (seed.error) {
    console.error("[campaign-claim] seed", seed.error.message);
    return { ok: false, error: "INTERNAL_ERROR", message: seed.error.message, http: 500 };
  }

  const { data: cc, error: ccErr } = await db
    .from("campaign_cards").select("*").eq("card_number", code).maybeSingle();
  if (ccErr || !cc)
    return { ok: false, error: "INTERNAL_ERROR", message: ccErr?.message || "Card row missing", http: 500 };

  // (b) active + not expired
  if (cc.status !== "active")
    return { ok: false, error: "NOT_REDEEMABLE", status: cc.status, message: "This card is no longer active.", http: 409 };
  if (cc.expires_at && new Date(cc.expires_at).getTime() <= Date.now())
    return { ok: false, error: "EXPIRED", status: "expired", message: "This card has expired.", http: 409 };

  // (c) ORDER GATE — must have placed at least one Dropy order. Also fetches the shop currency
  // we need for the credit below, in the same round-trip.
  const customerGid = `gid://shopify/Customer/${customerId}`;
  const info = await gql(admin, `#graphql
    query CampaignClaimInfo($id: ID!) {
      shop { currencyCode }
      customer(id: $id) { numberOfOrders }
    }`, { id: customerGid });
  const currency = info.shop.currencyCode;
  const orders = Number(info.customer?.numberOfOrders ?? 0);
  if (!(orders >= 1))
    return { ok: false, error: "ORDER_REQUIRED", message: "This card unlocks after your first Dropy order.", http: 403 };

  // (d) RESERVATION — claim the per-customer slot first. The (card_number, customer_id) PK
  // makes a repeat claim by the same customer a 23505 before any credit can be issued.
  const reservation = await db.from("card_claims").insert({
    card_number: code, customer_id: customerId, status: "pending",
  });
  if (reservation.error) {
    if (reservation.error.code === "23505")
      return { ok: false, error: "ALREADY_CLAIMED", status: "claimed", message: "You've already claimed this card.", http: 409 };
    return { ok: false, error: "INTERNAL_ERROR", message: reservation.error.message, http: 500 };
  }

  // (e) POOL — atomically take a slot. false ⇒ pool full; release the reservation so the
  // customer isn't left holding a pending row for a card they never got credit for. The
  // reservation drop is best-effort — log if it fails so an orphan pending row is traceable
  // (it would otherwise block this customer's retry), but don't mask the real reason here.
  const slot = await db.rpc("claim_campaign_slot", { p_card: code });
  if (slot.error) {
    await dropReservation(db, code, customerId);
    return { ok: false, error: "INTERNAL_ERROR", message: slot.error.message, http: 500 };
  }
  if (!slot.data) {
    await dropReservation(db, code, customerId);
    return { ok: false, error: "FULLY_CLAIMED", status: "exhausted", message: "This card has been fully claimed.", http: 409 };
  }

  // (f) CREDIT — only now that a slot is held. On failure, give the slot back and drop the
  // reservation so the customer can retry.
  let txn: any;
  try {
    const data = await gql(admin, `#graphql
      mutation CampaignCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction { id account { id balance { amount currencyCode } } }
          userErrors { field message code }
        }
      }`,
      { id: customerGid, creditInput: { creditAmount: { amount: String(cc.amount), currencyCode: currency } } }
    );
    const ue = data.storeCreditAccountCredit.userErrors;
    if (ue?.length) throw new Error(JSON.stringify(ue));
    txn = data.storeCreditAccountCredit.storeCreditAccountTransaction;
  } catch (e: any) {
    // Roll both guards back so the customer can retry and the slot is freed for someone else.
    // Each step is independently fault-tolerant: a failure to release/drop must not throw past
    // the CREDIT_FAILED return (which would otherwise strand the pending row AND the slot).
    try {
      const rel = await db.rpc("release_campaign_slot", { p_card: code });
      if (rel?.error) console.error("[campaign-claim] release slot", rel.error.message);
    } catch (relErr: any) {
      console.error("[campaign-claim] release slot threw", relErr?.message || relErr);
    }
    await dropReservation(db, code, customerId);
    console.error("[campaign-claim] credit failed", e?.message || e);
    return { ok: false, error: "CREDIT_FAILED", message: "Could not add the credit", http: 500 };
  }

  // Mark the reservation complete. The credit is already issued, so a failure here can't fail
  // the claim — but log it loudly: it leaves a 'pending' row for a paid-out claim to reconcile.
  const done = await db.from("card_claims")
    .update({ status: "complete", credit_gid: txn.id })
    .eq("card_number", code).eq("customer_id", customerId);
  if (done.error)
    console.error("[campaign-claim] complete-mark failed (credit already issued)", done.error.message);

  // (g) SYNC-BACK — best-effort mirror of claim_count (and status→"redeemed" at max) onto the
  // metaobject for the admin UI. Never fails the claim: the credit is already given and the
  // DB pool stays authoritative. "redeemed" is used (not "exhausted") because it passes the
  // metaobject status regex ^(unused|redeemed|disabled)$ and the admin UI already renders it.
  // campaign_cards.status in Supabase stays "active" — the RPC's claim_count guard is what keeps
  // returning "fully claimed" once the pool is drained.
  try {
    const { data: fresh } = await db
      .from("campaign_cards").select("claim_count, max_claims").eq("card_number", code).maybeSingle();
    const count = fresh?.claim_count ?? null;
    const atMax = count != null && count >= (fresh?.max_claims ?? maxClaims);
    const fields: { key: string; value: string }[] = [];
    if (count != null) fields.push({ key: "claim_count", value: String(count) });
    if (atMax) fields.push({ key: "status", value: "redeemed" });
    if (fields.length) {
      const upd = await gql(admin, `#graphql
        mutation CampaignSync($id: ID!, $fields: [MetaobjectFieldInput!]!) {
          metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
            metaobject { id }
            userErrors { field message code }
          }
        }`, { id: card.id, fields });
      if (upd.metaobjectUpdate.userErrors?.length)
        console.error("[campaign-claim] sync userErrors", JSON.stringify(upd.metaobjectUpdate.userErrors));
    }
  } catch (e: any) {
    console.error("[campaign-claim] sync-back failed (credit already given)", e?.message || e);
  }

  return { ok: true, amount: cc.amount, currency, newBalance: txn.account.balance.amount, transactionId: txn.id };
}
