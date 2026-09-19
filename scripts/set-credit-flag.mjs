#!/usr/bin/env node
/**
 * set-credit-flag.mjs — read and set the dropy-rewards store credit panel flag.
 *
 * A metafield DEFINITION only declares the field. Until a VALUE is written,
 * shop.metafields.dropy.credit_panel_enabled is nil and the widget keeps the
 * legacy panel. This writes the value.
 *
 * Two independent flags:
 *   credit_panel_enabled     the panel itself
 *   credit_checkout_enabled  only the "use it at checkout" line
 *
 * Usage:
 *   node scripts/set-credit-flag.mjs                    # report only, writes nothing
 *   node scripts/set-credit-flag.mjs true               # panel ON
 *   node scripts/set-credit-flag.mjs false              # panel OFF
 *   node scripts/set-credit-flag.mjs checkout true      # checkout line ON
 *   node scripts/set-credit-flag.mjs checkout false     # checkout line OFF
 *
 * Env: SHOPIFY_ADMIN_TOKEN (shpat_...), SHOP_DOMAIN (optional)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_VERSION = "2026-07";
const NAMESPACE = "dropy";
const KEYS = { panel: "credit_panel_enabled", checkout: "credit_checkout_enabled" };

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!env[m[1]]) env[m[1]] = v;
    }
  } catch {
    /* no .env — process env only */
  }
  return env;
}

const ENV = loadEnv();
const SHOP = ENV.SHOP_DOMAIN || "7n0vkr-rn.myshopify.com";
const TOKEN = ENV.SHOPIFY_ADMIN_TOKEN;
if (!TOKEN) {
  console.error("\n  Missing SHOPIFY_ADMIN_TOKEN (Dropy custom app token, starts with shpat_).\n");
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const argv = process.argv.slice(2);
let which = "panel";
let arg = argv[0];
if (arg === "panel" || arg === "checkout") { which = arg; arg = argv[1]; }
if (arg !== undefined && arg !== "true" && arg !== "false") {
  console.error(`\n  Argument must be true or false (got ${JSON.stringify(arg)}).\n`);
  console.error(`  e.g. node scripts/set-credit-flag.mjs checkout true\n`);
  process.exit(1);
}
const KEY = KEYS[which];

// ── report current state, both namespaces ────────────────────────────────────
const read = await gql(`{
  shop {
    id
    name
    panel: metafield(namespace: "${NAMESPACE}", key: "${KEYS.panel}") { value type }
    checkout: metafield(namespace: "${NAMESPACE}", key: "${KEYS.checkout}") { value type }
    wrongNamespace: metafield(namespace: "custom", key: "${KEY}") { value type }
    gift: metafield(namespace: "${NAMESPACE}", key: "gift_config") { updatedAt }
  }
}`);

const shop = read.shop;
const show = (m) => (m ? `${JSON.stringify(m.value)}${m.type ? ` (${m.type})` : ""}` : "not set");

console.log(`\n  Shop: ${shop.name}  ${SHOP}`);
console.log(`  ${NAMESPACE}.${KEYS.panel}     : ${show(shop.panel)}   <- the panel`);
console.log(`  ${NAMESPACE}.${KEYS.checkout}  : ${show(shop.checkout)}   <- the checkout line`);
console.log(`  custom.${KEY}  : ${show(shop.wrongNamespace)}`);
console.log(`  ${NAMESPACE}.gift_config  : ${shop.gift ? "present" : "MISSING"}`);

if (shop.wrongNamespace && !shop[which]) {
  console.log(`\n  The value landed under "custom", not "${NAMESPACE}". Liquid reads`);
  console.log(`  shop.metafields.${NAMESPACE}.${KEY}, so it will never see it.`);
}

if (arg === undefined) {
  console.log(`\n  Report only. Pass true or false to write.\n`);
  process.exit(0);
}

// ── write ────────────────────────────────────────────────────────────────────
const d = await gql(
  `mutation($mf:[MetafieldsSetInput!]!){
     metafieldsSet(metafields:$mf){
       metafields{ namespace key value type updatedAt }
       userErrors{ field message code }
     }
   }`,
  {
    mf: [{
      ownerId: shop.id,
      namespace: NAMESPACE,
      key: KEY,
      type: "boolean",
      value: arg,
    }],
  }
);

const { metafields, userErrors } = d.metafieldsSet;
if (userErrors.length) {
  console.error("\n  Shopify rejected the write:");
  for (const e of userErrors) console.error(`    ${e.code ?? ""} ${e.field ?? ""} ${e.message}`);
  process.exit(1);
}

const mf = metafields[0];
console.log(`\n  WROTE  ${mf.namespace}.${mf.key} = ${mf.value} (${mf.type})  ${mf.updatedAt}`);
console.log(`\n  Hard-refresh dropy.in and click the store credit icon.\n`);
