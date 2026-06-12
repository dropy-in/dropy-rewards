// Tests for the campaign-card pool claim engine (and a legacy single-use regression guard).
//
// These exercise the REAL claimCard() from card.server.ts against an in-memory fake that
// models the two things the race-safety depends on: the card_claims (card_number, customer_id)
// primary key (per-customer-once) and the claim_campaign_slot / release_campaign_slot RPCs as
// single atomic statements. The fake's mutating operations run synchronously with no internal
// await, mirroring Postgres row-level atomicity — so two interleaved claims serialize exactly
// as they would against the database.
import { describe, it, expect, beforeEach, vi } from "vitest";

// card.server.ts builds a Supabase client at import time; give it values so createClient()
// doesn't throw. The real client is never used — every claim is driven with an injected fake.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { claimCard } = await import("./card.server");

// ---------------------------------------------------------------------------
// Fake Postgres (the subset of the supabase-js builder that card.server.ts uses)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
type TableSpec = { pk: string[]; unique?: string[][]; defaults?: Row };

const SCHEMA: Record<string, TableSpec> = {
  campaign_cards: { pk: ["card_number"], defaults: { claim_count: 0, status: "active" } },
  card_claims: { pk: ["card_number", "customer_id"], defaults: { status: "pending" } },
  loyalty_customers: { pk: ["shopify_customer_id"] },
  // ref_id carries a unique constraint in the real schema (legacy single-use dedup).
  loyalty_ledger: { pk: ["id"], unique: [["ref_id"]] },
  loyalty_redemptions: { pk: ["id"] },
};

class FakeDb {
  tables: Record<string, Row[]> = {};
  seq = 0;
  constructor() {
    for (const name of Object.keys(SCHEMA)) this.tables[name] = [];
  }
  from(table: string) {
    return new QueryBuilder(this, table);
  }
  // RPCs are single atomic statements: synchronous, no await between read and write.
  rpc(fn: string, args: Row = {}) {
    return thenable(() => {
      const rows = this.tables.campaign_cards;
      const row = rows.find((r) => r.card_number === args.p_card);
      if (fn === "claim_campaign_slot") {
        if (row && row.claim_count < row.max_claims && row.status === "active") {
          row.claim_count += 1;
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      if (fn === "release_campaign_slot") {
        if (row && row.claim_count > 0) {
          row.claim_count -= 1;
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      throw new Error("unknown rpc " + fn);
    });
  }
}

function thenable<T>(run: () => T) {
  return {
    then(resolve: (v: T) => void, reject: (e: any) => void) {
      try {
        resolve(run());
      } catch (e) {
        reject(e);
      }
    },
  };
}

class QueryBuilder {
  private op: "select" | "insert" | "upsert" | "update" | "delete" | null = null;
  private row: Row | null = null;
  private patch: Row | null = null;
  private filters: [string, any][] = [];
  private singleKind: "single" | "maybe" | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;
  constructor(private db: FakeDb, private table: string) {}

  insert(row: Row) { this.op = "insert"; this.row = row; return this; }
  upsert(row: Row, opts?: any) { this.op = "upsert"; this.row = row; this.upsertOpts = opts || {}; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  select(_cols?: string) { if (!this.op) this.op = "select"; return this; }
  eq(col: string, val: any) { this.filters.push([col, val]); return this; }
  single() { this.singleKind = "single"; return this; }
  maybeSingle() { this.singleKind = "maybe"; return this; }

  then(resolve: (v: any) => void, reject: (e: any) => void) {
    try {
      resolve(this.run());
    } catch (e) {
      reject(e);
    }
  }

  private spec() { return SCHEMA[this.table]; }
  private rows() { return this.db.tables[this.table]; }
  private matches(r: Row) { return this.filters.every(([c, v]) => r[c] === v); }

  private conflict(row: Row, by?: string[]) {
    const spec = this.spec();
    const keys = by ? [by] : [spec.pk, ...(spec.unique || [])];
    return this.rows().find((existing) =>
      keys.some((cols) =>
        cols.every((c) => existing[c] === row[c]) &&
        // a unique constraint only bites when every column in it is present
        cols.every((c) => row[c] !== undefined && row[c] !== null),
      ),
    );
  }

  private withDefaults(row: Row): Row {
    const spec = this.spec();
    const out: Row = { ...(spec.defaults || {}), ...row };
    if (out.id === undefined && spec.pk.includes("id")) out.id = ++this.db.seq;
    return out;
  }

  private dup() {
    return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
  }

  private shape(found: Row | undefined) {
    if (this.singleKind === "single") {
      if (!found) return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: { ...found }, error: null };
    }
    if (this.singleKind === "maybe") return { data: found ? { ...found } : null, error: null };
    return { data: found ? [{ ...found }] : [], error: null };
  }

  private run() {
    switch (this.op) {
      case "insert": {
        if (this.conflict(this.row!)) return this.dup();
        const stored = this.withDefaults(this.row!);
        this.rows().push(stored);
        if (this.singleKind) return this.shape(stored);
        return { data: null, error: null };
      }
      case "upsert": {
        const onConflict = this.upsertOpts?.onConflict?.split(",").map((s) => s.trim());
        const existing = this.conflict(this.row!, onConflict);
        if (existing) {
          if (!this.upsertOpts?.ignoreDuplicates) Object.assign(existing, this.row);
          return { data: null, error: null };
        }
        this.rows().push(this.withDefaults(this.row!));
        return { data: null, error: null };
      }
      case "update": {
        for (const r of this.rows()) if (this.matches(r)) Object.assign(r, this.patch);
        return { data: null, error: null };
      }
      case "delete": {
        this.db.tables[this.table] = this.rows().filter((r) => !this.matches(r));
        return { data: null, error: null };
      }
      case "select":
      default: {
        const hits = this.rows().filter((r) => this.matches(r));
        if (this.singleKind) return this.shape(hits[0]);
        return { data: hits.map((r) => ({ ...r })), error: null };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fake Shopify admin
// ---------------------------------------------------------------------------

type CardSeed = { code: string; fields: Row; id?: string };

function makeWorld(opts: {
  cards: CardSeed[];
  currency?: string;
}) {
  const currency = opts.currency || "INR";
  const cards = new Map(opts.cards.map((c, i) => [c.code, { id: c.id || `gid://shopify/Metaobject/${1000 + i}`, fields: c.fields }]));
  const state = {
    creditFails: false,
    credits: [] as { customer: string; amount: number; expiresAt: string | null }[],
    balance: {} as Record<string, number>,
    metaobjectUpdates: [] as { id: string; fields: Row[] }[],
  };

  const customerIdFromGid = (gid: string) => String(gid).split("/").pop();

  const admin = {
    graphql: vi.fn(async (query: string, init: { variables?: Row } = {}) => {
      const v = init.variables || {};
      let data: Row = {};

      if (query.includes("metaobjectByHandle")) {
        const handle = v.handle?.handle || "";
        const code = handle.replace(/^card-/, "");
        const card = cards.get(code);
        data = {
          metaobjectByHandle: card
            ? { id: card.id, handle, fields: Object.entries(card.fields).map(([key, value]) => ({ key, value: String(value) })) }
            : null,
        };
      } else if (query.includes("storeCreditAccountCredit")) {
        if (state.creditFails) {
          data = { storeCreditAccountCredit: { storeCreditAccountTransaction: null, userErrors: [{ field: null, message: "credit blocked", code: "FAILED" }] } };
        } else {
          const cust = customerIdFromGid(v.id)!;
          const amt = Number(v.creditInput.creditAmount.amount);
          state.credits.push({ customer: cust, amount: amt, expiresAt: v.creditInput.expiresAt ?? null });
          state.balance[cust] = (state.balance[cust] || 0) + amt;
          data = {
            storeCreditAccountCredit: {
              storeCreditAccountTransaction: {
                id: `gid://shopify/StoreCreditAccountTransaction/${state.credits.length}`,
                account: { id: `gid://shopify/StoreCreditAccount/${cust}`, balance: { amount: state.balance[cust].toFixed(2), currencyCode: currency } },
              },
              userErrors: [],
            },
          };
        }
      } else if (query.includes("metaobjectUpdate")) {
        state.metaobjectUpdates.push({ id: v.id, fields: v.fields });
        data = { metaobjectUpdate: { metaobject: { id: v.id }, userErrors: [] } };
      } else if (query.includes("CampaignClaimInfo")) {
        data = { shop: { currencyCode: currency } };
      } else if (query.includes("CardClaimInfo")) {
        const cust = customerIdFromGid(v.id)!;
        data = { shop: { currencyCode: currency }, customer: { email: `${cust}@example.com`, firstName: "Test" } };
      } else {
        throw new Error("unexpected query: " + query.slice(0, 80));
      }

      return { json: async () => ({ data }) };
    }),
  };

  return { admin, state };
}

const CAMPAIGN = (over: Row = {}): Row => ({ card_type: "campaign", credit_amount: "500", max_claims: "3", claim_count: "0", ...over });

// ---------------------------------------------------------------------------

describe("campaign card pool", () => {
  let db: FakeDb;
  beforeEach(() => { db = new FakeDb(); });

  it("max_claims=3: A claims, A again rejected, B + C claim, D fully claimed", async () => {
    const code = "1111222233334444";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ max_claims: "3" }) }] });

    const a1 = await claimCard(admin, "A", code, db);
    expect(a1.ok).toBe(true);
    if (a1.ok) { expect(a1.amount).toBe(500); expect(a1.transactionId).toMatch(/StoreCreditAccountTransaction/); }

    const a2 = await claimCard(admin, "A", code, db);
    expect(a2).toMatchObject({ ok: false, error: "ALREADY_CLAIMED", http: 409 });

    const b = await claimCard(admin, "B", code, db);
    const c = await claimCard(admin, "C", code, db);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);

    const d = await claimCard(admin, "D", code, db);
    expect(d).toMatchObject({ ok: false, error: "FULLY_CLAIMED", http: 409 });

    // exactly 3 distinct customers credited; pool at max; D left no orphan reservation
    expect(state.credits.map((x) => x.customer).sort()).toEqual(["A", "B", "C"]);
    const card = db.tables.campaign_cards[0];
    expect(card.claim_count).toBe(3);
    expect(db.tables.card_claims.map((r) => r.customer_id).sort()).toEqual(["A", "B", "C"]);
    expect(db.tables.card_claims.every((r) => r.status === "complete")).toBe(true);
  });

  it("a brand-new customer with zero orders can claim (no order gate)", async () => {
    const code = "5555666677778888";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN() }] });

    // No customer/numberOfOrders lookup happens at all — campaign cards are acquisition cards.
    const res = await claimCard(admin, "Z", code, db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.amount).toBe(500);

    expect(state.credits).toHaveLength(1);
    expect(state.credits[0]).toMatchObject({ customer: "Z", amount: 500 });
    expect(db.tables.card_claims).toHaveLength(1);
    expect(db.tables.campaign_cards[0].claim_count).toBe(1);
  });

  it("concurrent double-submit by one customer credits exactly once (PK + RPC guard)", async () => {
    const code = "9999000011112222";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ max_claims: "5" }) }] });

    const [r1, r2] = await Promise.all([claimCard(admin, "A", code, db), claimCard(admin, "A", code, db)]);

    const oks = [r1, r2].filter((r) => r.ok);
    const rejects = [r1, r2].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(rejects).toHaveLength(1);
    expect((rejects[0] as any).error).toBe("ALREADY_CLAIMED");

    // the guards held: one credit, pool incremented once, one reservation row
    expect(state.credits).toHaveLength(1);
    expect(db.tables.campaign_cards[0].claim_count).toBe(1);
    expect(db.tables.card_claims).toHaveLength(1);
  });

  it("two different customers racing the final slot: exactly one wins via the RPC pool guard", async () => {
    // max_claims=1, so the only slot IS the final slot. Both customers pass the per-customer PK
    // (different customer_ids), so the PK can't be what serializes them — only the atomic
    // claim_campaign_slot RPC (modeled here as a synchronous, no-await critical section, exactly
    // as a single guarded Postgres UPDATE behaves under row locks) can let just one through.
    const code = "2323232323232323";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ max_claims: "1" }) }] });

    const [b, c] = await Promise.all([claimCard(admin, "B", code, db), claimCard(admin, "C", code, db)]);

    expect([b, c].filter((r) => r.ok)).toHaveLength(1);
    const loser = [b, c].find((r) => !r.ok)!;
    expect((loser as any).error).toBe("FULLY_CLAIMED");

    expect(state.credits).toHaveLength(1);
    expect(db.tables.campaign_cards[0].claim_count).toBe(1);
    // the loser's reservation was rolled back, leaving exactly one complete claim
    expect(db.tables.card_claims).toHaveLength(1);
    expect(db.tables.card_claims[0].status).toBe("complete");
  });

  it("misconfigured card (max_claims=0) is rejected before any DB seed or credit", async () => {
    const code = "4545454545454545";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ max_claims: "0" }) }] });

    const res = await claimCard(admin, "A", code, db);
    expect(res).toMatchObject({ ok: false, error: "CREDIT_FAILED" });
    expect(state.credits).toHaveLength(0);
    expect(db.tables.campaign_cards).toHaveLength(0);
  });

  it("expired card (past claim window) is rejected and writes no rows", async () => {
    const code = "1212121212121212";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ expires_at: "2000-01-01T00:00:00Z" }) }] });

    const res = await claimCard(admin, "A", code, db);
    expect(res).toMatchObject({ ok: false, error: "EXPIRED", http: 409 });
    if (!res.ok) expect(res.message).toBe("This card has expired.");

    // rejected BEFORE any seed/reservation — no rows written
    expect(state.credits).toHaveLength(0);
    expect(db.tables.campaign_cards).toHaveLength(0);
    expect(db.tables.card_claims).toHaveLength(0);
  });

  it("credit expiry: storeCreditAccountCredit receives expiresAt = now + credit_valid_days", async () => {
    const code = "6767676767676767";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ credit_valid_days: "30" }) }] });

    const before = Date.now();
    const res = await claimCard(admin, "A", code, db);
    expect(res.ok).toBe(true);

    const credit = state.credits[0];
    expect(credit.expiresAt).toBeTruthy();
    const got = new Date(credit.expiresAt!).getTime();
    // ~30 days out; generous window absorbs the wall-clock elapsed during the call
    expect(got).toBeGreaterThanOrEqual(before + 30 * 86_400_000 - 5_000);
    expect(got).toBeLessThanOrEqual(Date.now() + 30 * 86_400_000 + 5_000);
  });

  it("credit expiry: defaults to 60 days when credit_valid_days is absent", async () => {
    const code = "6868686868686868";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN() }] }); // no credit_valid_days

    const before = Date.now();
    await claimCard(admin, "A", code, db);

    const got = new Date(state.credits[0].expiresAt!).getTime();
    expect(got).toBeGreaterThanOrEqual(before + 60 * 86_400_000 - 5_000);
    expect(got).toBeLessThanOrEqual(Date.now() + 60 * 86_400_000 + 5_000);
  });

  it("credit failure rolls back the slot + reservation, and a retry then succeeds", async () => {
    const code = "3434343434343434";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ max_claims: "2" }) }] });

    state.creditFails = true;
    const fail = await claimCard(admin, "A", code, db);
    expect(fail).toMatchObject({ ok: false, error: "CREDIT_FAILED" });
    // pool released, reservation removed → no orphan
    expect(db.tables.campaign_cards[0].claim_count).toBe(0);
    expect(db.tables.card_claims).toHaveLength(0);

    state.creditFails = false;
    const ok = await claimCard(admin, "A", code, db);
    expect(ok.ok).toBe(true);
    expect(state.credits).toHaveLength(1);
    expect(db.tables.campaign_cards[0].claim_count).toBe(1);
  });

  it("syncs claim_count back to the metaobject, marking status redeemed at max", async () => {
    const code = "5656565656565656";
    const { admin, state } = makeWorld({ cards: [{ code, fields: CAMPAIGN({ max_claims: "1" }) }] });

    await claimCard(admin, "A", code, db);
    const sync = state.metaobjectUpdates.at(-1)!;
    const byKey = Object.fromEntries(sync.fields.map((f) => [f.key, f.value]));
    expect(byKey.claim_count).toBe("1");
    // "redeemed" passes the metaobject status regex ^(unused|redeemed|disabled)$
    expect(byKey.status).toBe("redeemed");
    // Supabase pool row stays "active"; the RPC claim_count guard enforces exhaustion
    expect(db.tables.campaign_cards[0].status).toBe("active");
  });
});

describe("legacy single-use card (regression)", () => {
  let db: FakeDb;
  beforeEach(() => { db = new FakeDb(); });

  it("credits once; a second claim is single-claimed by the ledger unique guard", async () => {
    const code = "7777888899990000";
    // legacy card: no card_type, status unused. The fake metaobject status does NOT flip on
    // MarkRedeemed, so the second claim must be stopped by the loyalty_ledger ref_id unique
    // constraint (23505) — the DB-level single-claim guard.
    const { admin, state } = makeWorld({ cards: [{ code, fields: { status: "unused", credit_amount: "300", batch_id: "B1" } }] });

    const first = await claimCard(admin, "A", code, db);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.amount).toBe(300);

    const second = await claimCard(admin, "A", code, db);
    expect(second).toMatchObject({ ok: false, error: "NOT_REDEEMABLE", status: "redeemed", http: 409 });

    expect(state.credits).toHaveLength(1);
    // legacy credit carries no per-customer expiry — that's campaign-only
    expect(state.credits[0].expiresAt).toBeNull();
    expect(db.tables.loyalty_ledger).toHaveLength(1);
  });

  it("non-existent card returns NOT_FOUND", async () => {
    const { admin } = makeWorld({ cards: [] });
    const res = await claimCard(admin, "A", "0000000000000000", db);
    expect(res).toMatchObject({ ok: false, error: "NOT_FOUND", http: 404 });
  });
});
