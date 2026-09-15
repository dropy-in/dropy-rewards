#!/usr/bin/env node
/**
 * publish-config.mjs — Supabase (PRODUCTION) -> Shopify shop metafields
 *
 * The storefront reads gift/exit/wishlist config from Shopify metafields
 * (rendered by blocks/rewards-widget.liquid) instead of calling Vercel on every
 * page load. The admin UI still writes to Supabase; this carries edits across.
 *
 * Replays the EXACT transforms in:
 *   app/routes/proxy.gift.config.tsx
 *   app/routes/proxy.exit.config.tsx
 *   app/routes/proxy.wishlist.config.tsx
 * If you change a route, change the matching build*() below.
 *
 * Usage:
 *   node scripts/publish-config.mjs --dry-run        # always do this first
 *   node scripts/publish-config.mjs                  # write all three
 *   node scripts/publish-config.mjs gift             # write one
 *   node scripts/publish-config.mjs --allow-legacy   # bypass the gift_tiers guard
 *
 * Reads from .env in the repo root:
 *   SUPABASE_PROD_URL, SUPABASE_PROD_SERVICE_ROLE_KEY, SHOPIFY_ADMIN_TOKEN
 *   SHOP_DOMAIN (optional)
 *
 * PRODUCTION ONLY. It deliberately ignores SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY,
 * which point at the dev project — reading those once produced snowboard handles
 * that would have silently disabled the free gift on the live store.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_VERSION = "2026-07";
const NAMESPACE = "dropy";

// Handles that indicate a dev store / Shopify sample catalogue. None exist on
// dropy.in, so publishing them would render an empty gift popup.
const SAMPLE_MARKERS = ["snowboard", "the-collection-", "the-3p-", "the-archived", "example", "test-product"];

// ── env ──────────────────────────────────────────────────────────────────────
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

function requireEnv(name, hint) {
  if (!ENV[name]) {
    console.error(`\n  Missing ${name}${hint ? ` (${hint})` : ""}.`);
    console.error(`  Add it to ${join(ROOT, ".env")} and run again.\n`);
    process.exit(1);
  }
  return ENV[name];
}

function projectRef(url) {
  const m = String(url).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : "UNKNOWN";
}

// ── supabase ─────────────────────────────────────────────────────────────────
async function readConfigRows(keys) {
  const url = requireEnv("SUPABASE_PROD_URL", "production project URL");
  const key = requireEnv("SUPABASE_PROD_SERVICE_ROLE_KEY", "production service_role key");

  const q = `${url.replace(/\/$/, "")}/rest/v1/loyalty_config` +
    `?select=key,value&key=in.(${keys.join(",")})`;
  const res = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const rows = await res.json();
  return { ref: projectRef(url), rows: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

// ── transforms (mirror the proxy routes exactly) ─────────────────────────────
function buildGift(c) {
  let tiers = [];
  let usedLegacy = false;

  if (c.gift_tiers) {
    try {
      tiers = JSON.parse(c.gift_tiers)
        .map((t) => ({
          threshold: parseInt(String(t.threshold_paise ?? t.threshold ?? 0), 10) || 0,
          handles: Array.isArray(t.handles) ? t.handles.map(String).filter(Boolean) : [],
          label: String(t.label ?? "free gift"),
        }))
        .filter((t) => t.handles.length > 0 && t.threshold > 0);
    } catch {
      tiers = [];
    }
  }
  if (!tiers.length) {
    usedLegacy = true;
    let handles = [];
    try {
      handles = JSON.parse(c.gift_products ?? "[]").map((p) => p.handle).filter(Boolean);
    } catch {
      handles = [];
    }
    if (handles.length) {
      tiers = [{
        threshold: parseInt(c.gift_threshold_paise ?? "249900", 10),
        handles,
        label: "free gift",
      }];
    }
  }

  const out = {
    enabled: (c.gift_enabled ?? "0") === "1" && tiers.some((t) => t.handles.length > 0),
    lazy_mode: (c.gift_lazy_mode ?? "0") === "1",
    tiers,
    threshold: tiers[0]?.threshold ?? parseInt(c.gift_threshold_paise ?? "249900", 10),
    handles: tiers[0]?.handles ?? [],
  };
  return { out, usedLegacy };
}

function buildExit(c) {
  if (!c.exit_config) return null;
  try {
    return JSON.parse(c.exit_config);
  } catch {
    return null;
  }
}

function buildWishlist(c) {
  let cfg = {};
  if (c.wishlist_config) {
    try { cfg = JSON.parse(c.wishlist_config); } catch { cfg = {}; }
  }
  const hex = typeof cfg.heart_color === "string" && /^#[0-9a-fA-F]{6}$/.test(cfg.heart_color);
  return {
    enabled: cfg.enabled !== false,
    heart_color: hex ? cfg.heart_color : "#ef4444",
    show_cards: cfg.show_cards !== false,
    show_pdp: cfg.show_pdp !== false,
    show_header: cfg.show_header !== false,
    show_mobile_nav: cfg.show_mobile_nav !== false,
  };
}

// ── shopify ──────────────────────────────────────────────────────────────────
async function shopifyGraphQL(query, variables) {
  const token = requireEnv("SHOPIFY_ADMIN_TOKEN", "Dropy custom app token, starts with shpat_");
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

async function writeMetafields(ownerId, entries) {
  const d = await shopifyGraphQL(
    `mutation($mf:[MetafieldsSetInput!]!){
       metafieldsSet(metafields:$mf){
         metafields{ namespace key updatedAt }
         userErrors{ field message code }
       }
     }`,
    {
      mf: entries.map(([key, value]) => ({
        ownerId, namespace: NAMESPACE, key, type: "json", value: JSON.stringify(value),
      })),
    }
  );
  const { metafields, userErrors } = d.metafieldsSet;
  if (userErrors.length) {
    console.error("\n  Shopify rejected the write:");
    for (const e of userErrors) console.error(`    ${e.code ?? ""} ${e.field ?? ""} ${e.message}`);
    process.exit(1);
  }
  return metafields;
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allowLegacy = args.includes("--allow-legacy");
const only = args.filter((a) => !a.startsWith("--"));
const want = (n) => only.length === 0 || only.includes(n);

const { ref, rows } = await readConfigRows([
  "gift_enabled", "gift_tiers", "gift_threshold_paise", "gift_products", "gift_lazy_mode",
  "exit_config", "wishlist_config",
]);

console.log(`\n  Supabase project : ${ref}`);
console.log(`  Shopify store    : ${SHOP}`);
console.log(`  Mode             : ${dryRun ? "DRY RUN — nothing will be written" : "WRITE"}`);

const blockers = [];
const built = [];

if (want("gift")) {
  const { out, usedLegacy } = buildGift(rows);

  if (usedLegacy && !allowLegacy) {
    blockers.push(
      "gift_tiers is missing or unusable, so the legacy gift_products fallback ran.\n" +
      "     Production has that row. Its absence means you are almost certainly pointed\n" +
      "     at the wrong Supabase project. Override with --allow-legacy if intentional."
    );
  }
  const bad = out.tiers.flatMap((t) => t.handles)
    .filter((h) => SAMPLE_MARKERS.some((m) => h.toLowerCase().includes(m)));
  if (bad.length) blockers.push(`gift handles look like dev-store sample data: ${bad.join(", ")}`);

  if (!out.enabled || !out.tiers.length) {
    blockers.push("gift config resolves to disabled or has no usable tiers — publishing would turn the free gift OFF.");
  }
  built.push(["gift_config", out]);
}

if (want("exit")) {
  const out = buildExit(rows);
  if (out === null) {
    console.log("\n  SKIPPING exit_config — no row in this project. Writing null would break the exit module.");
  } else {
    built.push(["exit_config", out]);
  }
}

if (want("wishlist")) built.push(["wishlist_config", buildWishlist(rows)]);

if (!built.length) {
  console.error("\n  Nothing to publish. Use: gift | exit | wishlist, or no argument for all.\n");
  process.exit(1);
}

for (const [key, value] of built) {
  console.log(`\n  -- ${NAMESPACE}.${key} ${"-".repeat(Math.max(0, 48 - key.length))}`);
  console.log(JSON.stringify(value, null, 2).split("\n").map((l) => "  " + l).join("\n"));
}

if (blockers.length) {
  console.error("\n  REFUSING TO WRITE:");
  for (const b of blockers) console.error(`   - ${b}`);
  console.error("");
  process.exit(1);
}

if (dryRun) {
  console.log("\n  Dry run complete. Nothing written.\n");
  process.exit(0);
}

const d = await shopifyGraphQL("{ shop { id name } }", {});
const written = await writeMetafields(d.shop.id, built);

console.log(`\n  Published to ${d.shop.name}:`);
for (const m of written) console.log(`    ${m.namespace}.${m.key}  ${m.updatedAt}`);
console.log("\n  Hard-reload dropy.in to confirm.\n");
process.exit(0);
