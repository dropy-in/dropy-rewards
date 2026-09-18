#!/usr/bin/env node
/**
 * backfill-store-credit.mjs
 *
 * Earning broke around 2 Sept 2026 and stopped entirely after the 9th: the orders/paid
 * webhook stopped being delivered, so neither loyalty points nor the 3% store credit were
 * issued. This reissues the missing store credit.
 *
 * SAFETY — this script is idempotent by design:
 *   - It skips any order that already has an `earn_order` row in loyalty_ledger.
 *   - After crediting, it writes an `earn_order` row with that order_id, so a second run
 *     skips it. loyalty_ledger has a unique index on order_id (the app relies on error
 *     23505 for this), which is the real guard.
 *   - --dry-run prints every decision and writes nothing, anywhere.
 *
 * Credit rule, copied from creditStoreCreditFromOrder in app/loyalty.server.ts:
 *   credit = round(subtotal * 3) / 100   (subtotal = post-discount, pre-shipping)
 * We use currentSubtotalPriceSet so refunded/removed items are not credited.
 *
 * Usage:
 *   node scripts/backfill-store-credit.mjs --dry-run
 *   node scripts/backfill-store-credit.mjs --dry-run --since 2026-09-01
 *   node scripts/backfill-store-credit.mjs --limit 5      # credit 5, then stop
 *   node scripts/backfill-store-credit.mjs                # the whole window
 *
 * Reads from .env: SUPABASE_PROD_URL, SUPABASE_PROD_SERVICE_ROLE_KEY,
 *                  SHOPIFY_ADMIN_TOKEN, SHOP_DOMAIN (optional)
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_VERSION = "2026-07";
const CASHBACK_PERCENT = 3;
const CURRENCY = "INR";
const LOG = join(ROOT, "backfill-store-credit.log");

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!env[m[1]]) env[m[1]] = v;
    }
  } catch { /* process env only */ }
  return env;
}
const ENV = loadEnv();
const SHOP = ENV.SHOP_DOMAIN || "7n0vkr-rn.myshopify.com";

function need(name, hint) {
  if (!ENV[name]) {
    console.error(`\n  Missing ${name}${hint ? ` (${hint})` : ""}. Add it to ${join(ROOT, ".env")}.\n`);
    process.exit(1);
  }
  return ENV[name];
}
const projectRef = (u) => (String(u).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [, "UNKNOWN"])[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── shopify ──────────────────────────────────────────────────────────────────
let lastThrottle = null;

async function shopify(query, variables) {
  const token = need("SHOPIFY_ADMIN_TOKEN", "Dropy custom app token, starts with shpat_");
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    lastThrottle = json?.extensions?.cost?.throttleStatus ?? lastThrottle;

    const throttled = json.errors?.some?.((e) => String(e.message).toUpperCase().includes("THROTTLED"));
    if (throttled) {
      const wait = 2000 * attempt;
      console.log(`     throttled, waiting ${wait}ms (attempt ${attempt}/5)`);
      await sleep(wait);
      continue;
    }
    if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);

    // Pace ourselves so we never hit the wall in the first place.
    if (lastThrottle && lastThrottle.currentlyAvailable < 300) {
      const wait = Math.ceil((400 - lastThrottle.currentlyAvailable) / (lastThrottle.restoreRate || 100)) * 1000;
      console.log(`     bucket low (${Math.round(lastThrottle.currentlyAvailable)}), pausing ${wait}ms`);
      await sleep(wait);
    }
    return json.data;
  }
  throw new Error("Shopify: still throttled after 5 attempts");
}

async function* paidOrders(since) {
  let cursor = null;
  for (;;) {
    const d = await shopify(
      `query($cursor:String,$q:String!){
         orders(first:100, after:$cursor, query:$q, sortKey:CREATED_AT) {
           pageInfo { hasNextPage endCursor }
           nodes {
             id name createdAt displayFinancialStatus test
             customer { id displayName }
             currentSubtotalPriceSet { shopMoney { amount currencyCode } }
             subtotalPriceSet { shopMoney { amount } }
           }
         }
       }`,
      { cursor, q: `created_at:>=${since} AND financial_status:paid` }
    );
    for (const n of d.orders.nodes) yield n;
    if (!d.orders.pageInfo.hasNextPage) return;
    cursor = d.orders.pageInfo.endCursor;
  }
}

async function creditCustomer(customerGid, amount) {
  const d = await shopify(
    `mutation credit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
       storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
         storeCreditAccountTransaction { amount { amount currencyCode } }
         userErrors { field message }
       }
     }`,
    { id: customerGid, creditInput: { creditAmount: { amount: amount.toFixed(2), currencyCode: CURRENCY } } }
  );
  const errs = d?.storeCreditAccountCredit?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  return d.storeCreditAccountCredit.storeCreditAccountTransaction;
}

// ── supabase ─────────────────────────────────────────────────────────────────
const SB_URL = () => need("SUPABASE_PROD_URL", "production project URL").replace(/\/$/, "");
const SB_KEY = () => need("SUPABASE_PROD_SERVICE_ROLE_KEY", "production service_role key");
const sbHeaders = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json" });

// Pull EVERY earn_order id, with no date filter. Filtering the ledger by date was wrong:
// an order Shopify dates on/after `since` can have a ledger row written the day before
// (timezone boundary), so it fell outside the query and looked uncredited -- which would
// have credited it a second time.
async function existingOrderIds() {
  const ids = new Set();
  let from = 0;
  for (;;) {
    const url = `${SB_URL()}/rest/v1/loyalty_ledger?select=order_id&type=eq.earn_order&order_id=not.is.null`;
    const res = await fetch(url, { headers: { ...sbHeaders(), Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    rows.forEach((r) => r.order_id && ids.add(String(r.order_id)));
    if (rows.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function writeLedgerRow(row) {
  const res = await fetch(`${SB_URL()}/rest/v1/loyalty_ledger`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (res.status === 409) return "duplicate";      // unique index on order_id
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return "written";
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sinceArg = args.indexOf("--since");
const since = sinceArg !== -1 ? args[sinceArg + 1] : "2026-09-01";
const limitArg = args.indexOf("--limit");
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;

console.log(`\n  Shopify store    : ${SHOP}`);
console.log(`  Supabase project : ${projectRef(ENV.SUPABASE_PROD_URL)}`);
console.log(`  Orders since     : ${since}  (paid only)`);
console.log(`  Mode             : ${dryRun ? "DRY RUN -- nothing written" : "WRITE"}`);
if (limit !== Infinity) console.log(`  Limit            : ${limit} order(s)`);

console.log(`\n  Loading every already-credited order id from loyalty_ledger...`);
const already = await existingOrderIds();
console.log(`  ${already.size} order(s) have an earn_order row -- these are skipped.\n`);

let seen = 0, skipCredited = 0, skipGuest = 0, skipZero = 0, skipTest = 0, done = 0, failed = 0, total = 0;
const rows = [];

for await (const o of paidOrders(since)) {
  seen++;
  const numericId = o.id.split("/").pop();

  if (o.test) { skipTest++; continue; }
  if (already.has(numericId)) { skipCredited++; continue; }
  if (!o.customer?.id) { skipGuest++; continue; }

  const subtotal = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount ?? "0");
  const credit = Math.round(subtotal * CASHBACK_PERCENT) / 100;
  if (credit <= 0) { skipZero++; continue; }

  if (done >= limit) break;
  total += credit;
  rows.push({ name: o.name, when: o.createdAt.slice(0, 10), who: o.customer.displayName, subtotal, credit });

  if (dryRun) { done++; continue; }

  try {
    await creditCustomer(o.customer.id, credit);
    const status = await writeLedgerRow({
      customer_id: String(o.customer.id.split("/").pop()),
      type: "earn_order",
      points: 0,
      order_id: numericId,
      order_name: o.name,
      amount_paise: Math.round(subtotal * 100),
      note: `store-credit backfill Rs${credit.toFixed(2)}`,
    });
    appendFileSync(LOG, `${new Date().toISOString()}\t${o.name}\t${numericId}\tRs${credit.toFixed(2)}\t${status}\n`);
    done++;
    if (done % 25 === 0) console.log(`  ... ${done} credited so far`);
  } catch (e) {
    failed++;
    console.error(`  FAILED ${o.name}: ${String(e).slice(0, 160)}`);
    appendFileSync(LOG, `${new Date().toISOString()}\t${o.name}\t${numericId}\tFAILED\t${String(e).slice(0, 160)}\n`);
  }
}

if (dryRun) {
  console.log("  Order      Date        Customer                        Subtotal     Credit");
  console.log("  " + "-".repeat(78));
  rows.slice(0, 40).forEach((r) =>
    console.log(`  ${r.name.padEnd(10)} ${r.when}  ${String(r.who).slice(0, 28).padEnd(30)} ${("Rs" + r.subtotal.toFixed(2)).padStart(11)} ${("Rs" + r.credit.toFixed(2)).padStart(10)}`)
  );
  if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
}

console.log(`\n  Orders scanned        : ${seen}`);
console.log(`  Skipped, already done : ${skipCredited}`);
console.log(`  Skipped, no customer  : ${skipGuest}`);
console.log(`  Skipped, zero credit  : ${skipZero}`);
console.log(`  Skipped, test order   : ${skipTest}`);
console.log(`  ${dryRun ? "Would credit" : "Credited"}          : ${done}`);
if (failed) console.log(`  FAILED                : ${failed}`);
console.log(`  Total credit          : Rs${total.toFixed(2)}`);
if (!dryRun && done) console.log(`\n  Log written to ${LOG}`);
console.log(dryRun ? "\n  Dry run complete. Nothing written.\n" : "\n  Done.\n");
process.exit(0);
