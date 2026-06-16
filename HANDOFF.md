# dropy-rewards — Engineering Handoff

> Loyalty, store-credit, campaign-card, and free-gift app for the live Shopify store **dropy.in** (Dropy India).
> Last updated: 2026-06-16.

---

## 0. Read this first (the 8 things that will bite you)

1. **The connected store is PRODUCTION.** This app is installed on the live store **Dropy India / dropy.in** (myshopify domain `7n0vkr-rn.myshopify.com`, production app `dropy-rewards`, client_id `00eed29be4a0e452a193f75c45788711`). Any Admin API / MCP call (metaobjects, store credit, discounts, metafields) hits **real production data**. There is no staging store wired into this repo besides the dev app config (`dropy-rewards-dev.myshopify.com`).
2. **There is NO Supabase migration runner.** `git push` and the build step do **not** apply SQL. The files in `supabase/migrations/*.sql` must be **pasted by hand into the Supabase SQL editor**. Worse: most `loyalty_*` tables/views have **no committed DDL at all** (see §6.3).
3. **The store is on the standard "Shopify" plan, NOT Plus.** Custom/unlisted-app **Shopify Functions cannot be activated** here (confirmed: `discountAutomaticAppCreate` → *"Shop must be on a Shopify Plus plan to activate functions from a custom app"*). The free-gift Function was built and then **reverted** for this reason; the current gift mechanism is client-side JS (see §9).
4. **Two deploy paths, two package managers, two lockfiles.** Server → `git push` → **Vercel (npm, `package-lock.json`)**. Extensions → `shopify app deploy` → **Shopify (pnpm, `pnpm-lock.yaml`)**. `pnpm-lock.yaml` is **gitignored on purpose** so it can't flip Vercel's PM detection. See §5.
5. **`core-js: false` in `pnpm-workspace.yaml` is load-bearing.** It's a build-gate fix; flipping/removing it re-breaks every `pnpm exec` / `shopify app deploy` (pnpm 11's ignored-build gate hard-fails).
6. **API version is set in two places that disagree (intentionally).** Admin GraphQL client = `ApiVersion.October25` (2025-10) in `app/shopify.server.ts`; webhook subscriptions = `2026-07` in `shopify.app.toml`. Don't "fix" one without checking the other.
7. **Scopes live in THREE places** that must stay in sync: the `SCOPES` env var (read at runtime), and `[access_scopes]` in **both** `shopify.app.toml` and `shopify.app.dev.toml`.
8. **Every commit lands on `main` and a push to `main` is a production deploy.** No PR gate; lint/tests are **not** in the Vercel build path.

---

## 1. What the app is

A Shopify **embedded admin app** + **storefront theme-app-extension** that implements a loyalty/rewards program for dropy.in:

- **Points** earned on paid orders and on signup; redeemable for Shopify rewards (discount codes, free shipping, free gift, **store credit**).
- **VIP tiers** based on buffered spend (multiplier + entry/ongoing rewards).
- **Dropy Credit Cards** — 16-digit codes (Shopify metaobjects) that issue store credit. Two flavors: legacy single-use cards, and **pooled campaign cards** (race-safe, N claims, per-customer-once, claim window + credit expiry).
- **Multi-tier cumulative free-gift popup** on the storefront cart (client-side enforced; see §9).
- An admin UI (Dashboard, Loyalty Program, Free Gift, Customers, Transactions).

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | **React Router 7** (framework mode, SSR) on **Vite 6** |
| Shopify glue | `@shopify/shopify-app-react-router` ^1.1.0, App Bridge React ^4.2.4, Polaris **web components** (`s-*`, typed via `@shopify/polaris-types`) — **not** Polaris React |
| Session store | Prisma ^6.16 → Postgres (`Session` model **only**) |
| App data | **Supabase Postgres** via `@supabase/supabase-js` ^2.108 (service-role key) |
| Hosting | **Vercel** (`@vercel/react-router` `vercelPreset()`) |
| Admin API | `ApiVersion.October25` (2025-10) |
| Extension | One **theme app extension** (`extensions/rewards-widget`, vanilla JS) |
| Tests | Vitest (`app/**/*.test.ts`) |
| Node | `>=20.19 <22 || >=22.12` (22.0–22.11 excluded; `engine-strict=true`) |

---

## 3. Repo map

```
app/
  shopify.server.ts        # shopifyApp() init; exports authenticate/unauthenticated/login/...
  db.server.ts             # Prisma singleton (Shopify sessions ONLY)
  supabase.server.ts       # shared Supabase service-role client `supabase`
  loyalty.server.ts        # loyalty/credit engine (points, redemption, VIP tiers, reward creation)
  card.server.ts           # Dropy Credit Card claim engine (legacy + campaign pool) — has its OWN supabase client `sb`
  card.server.test.ts      # vitest suite for claimCard() (in-memory FakeDb + fake admin)
  root.tsx                 # minimal HTML doc (no auth)
  entry.server.tsx         # SSR streaming entry (streamTimeout 5s)
  routes.ts                # flatRoutes() — file-system flat routing
  routes/
    app.tsx                # embedded shell: AppProvider + <s-app-nav> + <Outlet/>
    app._index.tsx         # Dashboard (metrics + recent webhooks) — read-only
    app.program.tsx        # Loyalty Program admin (earning / redeeming / VIP tabs)
    app.gift.tsx           # Free Gift Popup admin (multi-tier)
    app.customers.tsx      # Customers list (read-only, client-side search)
    app.transactions.tsx   # Ledger list (read-only, client-side search)
    auth.$.tsx             # /auth/* OAuth catch-all
    auth.login/route.tsx   # non-embedded shop-domain login form
    _index/route.tsx       # public landing (redirects to /app when ?shop=)
    proxy.summary.tsx      # GET  /apps/rewards/summary    (widget data)
    proxy.redeem.tsx       # POST /apps/rewards/redeem     (spend points)
    proxy.gift.config.tsx  # GET  /apps/rewards/gift/config(gift tiers)
    proxy.card.validate.tsx# POST /apps/rewards/card/validate (look up card)
    proxy.card.redeem.tsx  # POST /apps/rewards/card/redeem   (claim card)
    webhooks.app.uninstalled.tsx
    webhooks.app.scopes_update.tsx
    webhooks.orders.paid.tsx
    webhooks.refunds.create.tsx
    webhooks.customers.create.tsx
extensions/rewards-widget/ # theme app extension (the ONLY extension)
  assets/rewards-widget.js # drawer UI + gift popup + cart enforcement (vanilla, XHR)
  assets/rewards-widget.css
  blocks/rewards-widget.liquid  # block + {% schema %} merchant settings
  locales/en.default.json  # STALE: contains unrelated "ratings" keys (dead)
  shopify.extension.toml   # type="theme"
prisma/schema.prisma       # single Session model
supabase/migrations/
  0001_campaign_cards.sql  # campaign_cards + card_claims + RPCs (the ONLY committed DDL)
  0002_gift_tiers.sql      # seeds loyalty_config 'gift_tiers' from legacy keys
shopify.app.toml           # PRODUCTION app config
shopify.app.dev.toml       # DEV app config
shopify.web.toml           # web roles / predev=prisma generate
pnpm-workspace.yaml        # extensions/* + allowBuilds (core-js:false)
.npmrc                     # engine-strict + shamefully-hoist
package-lock.json          # TRACKED (Vercel/npm)
# pnpm-lock.yaml           # gitignored (local pnpm for shopify app deploy)
```

---

## 4. Environment variables

`.env` (gitignored) contains **only 4 keys** — all Supabase/DB, all pointing at the same Supabase project (`qehgeywmikgruwhvcbpq`, region `aws-1-ap-south-1`):

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service-role** key — bypasses RLS (full DB access) |
| `DATABASE_URL` | Prisma — pooler (`:6543`, `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | Prisma — direct (`:5432`, for migrate) |

**Shopify credentials are NOT in `.env`.** `app/shopify.server.ts` reads these from the environment:

| Var | Source |
|---|---|
| `SHOPIFY_API_KEY` | injected by Shopify CLI in dev; **set in Vercel** for prod |
| `SHOPIFY_API_SECRET` | same (HMAC/OAuth — defaults to `""` silently if missing!) |
| `SCOPES` | comma-separated; must match both TOMLs |
| `SHOPIFY_APP_URL` | app origin (defaults to `""` if missing) |
| `SHOP_CUSTOM_DOMAIN` | optional; adds `customShopDomains` |

> ⚠️ If the Shopify vars aren't set in Vercel, the server **boots anyway** (secret/url fall back to `""`) and OAuth/HMAC silently fail. There is no loud startup error.

---

## 5. Deploy pipelines

### Path 1 — Server (Vercel)
```
git push origin main   →   Vercel builds with npm (package-lock.json)
                            build = "prisma generate && react-router build"
                            vercelPreset() → serverless output
```
- Lint and tests are **not** run during the Vercel build.
- A push to `main` **is** a production deploy. There is no `vercel.json`.

### Path 2 — Extensions (Shopify CLI)
```
shopify app deploy --config shopify.app.toml --allow-updates --allow-deletes
```
- Builds/uploads the `extensions/*` workspace with **pnpm**, creates + releases a new app version.
- `--allow-updates`/`--allow-deletes` are the **non-interactive** equivalents of the confirmation prompt (this CLI version has no `--force`). `--allow-deletes` is needed when an extension was removed from the repo.
- Most recent releases this cycle: **dropy-rewards-14** (gift enforcement), **dropy-rewards-15** (consolidation).

### Why the dual lockfile
The two tools detect their package manager from the lockfile. `package-lock.json` is **tracked** (authoritative for Vercel/npm). `pnpm-lock.yaml` exists locally but is **gitignored** so an accidental `git add` can't flip Vercel to pnpm and change server build behavior. **Do not remove the `.gitignore` entry for `pnpm-lock.yaml`.**

### The core-js build gate
`pnpm-workspace.yaml` → `allowBuilds:` whitelists post-install scripts. `core-js: false` is a deliberate fix: pnpm 11.7 treats a build script that is neither explicitly allowed nor denied as a **hard error** (`ERR_PNPM_IGNORED_BUILDS`), which made every `pnpm exec` / `shopify app deploy` exit 1. Keep it `false` (core-js's postinstall is just a cosmetic banner).

---

## 6. Data layer

### 6.1 Prisma (sessions only)
`prisma/schema.prisma` has a **single `Session` model** (Postgres). It stores Shopify OAuth sessions via `PrismaSessionStorage`. Fields include `refreshToken`/`refreshTokenExpires` (for `future.expiringOfflineAccessTokens`). **No app/business data is in Prisma.**

### 6.2 Supabase clients
Two separate service-role clients (both from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, RLS bypassed):
- `app/supabase.server.ts` → exported `supabase` (used by `loyalty.server.ts` + proxy routes).
- `app/card.server.ts` → local `sb` (the card engine; `db` param is injectable for tests).

### 6.3 ⚠️ DDL reality
- **Committed DDL:** only `campaign_cards`, `card_claims`, and the two RPCs (`0001`), plus the `gift_tiers` seed (`0002`). Both files are idempotent (`if not exists` / `or replace` / `on conflict do nothing`) and must be **pasted manually** into the Supabase SQL editor.
- **NOT committed:** the entire `loyalty_*` family (`loyalty_config`, `loyalty_customers`, `loyalty_ledger`, `loyalty_programs`, `loyalty_redemptions`, `loyalty_tiers`, `loyalty_webhook_log`, and the views `loyalty_balances`, `loyalty_metrics`, `loyalty_spend`). These exist only in the live Supabase project; their schema below is **inferred from query usage**. **You cannot recreate the DB from this repo alone** — export the live schema before any rebuild.
- **Critical hidden dependency:** dedup/idempotency relies on UNIQUE constraints that aren't in checked-in DDL — `loyalty_ledger` needs uniques on `(order_id, type)`, on `ref_id`, and on the signup key. The code only catches Postgres `23505`. **If those indexes are missing in prod, retried webhooks double-issue points.**

### 6.4 `loyalty_config` — the key/value store
`key text` / `value text` (all values are strings, parsed at read). `getConfig()` reads the whole table and applies defaults:

| Key | Type | Default | Written by |
|---|---|---|---|
| `earn_amount_rupees` | int | 100 | `updateConfig` |
| `earn_points` | int | 10 | `updateConfig` |
| `pending_days` | int | 7 | `updateConfig` |
| `signup_points` | int | 10 | `updateConfig` |
| `point_value_paise` | int | 30 | `updateConfig` |
| `place_order_enabled` | "1"/"0" | "1" | `setConfigKey` |
| `signup_enabled` | "1"/"0" | "1" | `setConfigKey` |
| `vip_enabled` | "1"/"0" | "0" | `setConfigKey` |
| `gift_enabled` | "1"/"0" | "0" | `setConfigKey` |
| `tier_buffer_days` | int | 7 | `setTierBuffer` |
| `tier_window_days` | int | 0 | `setTierWindow` |
| `gift_tiers` | JSON string | — | `app.gift.tsx` (raw upsert) |
| `gift_threshold_paise` | int (legacy) | 249900 (₹2499) | — |
| `gift_products` | JSON string (legacy) | — | — |

Writes are allowlisted: `updateConfig()` only the 5 numeric earn keys (clamped ≥0); `setConfigKey()` only the 4 toggles (coerced "1"/"0", **throws** on any other key). `gift_tiers` is written **directly** by `app.gift.tsx` (bypassing those allowlists).

`gift_tiers` JSON shape: `[{ threshold_paise: int, handles: string[≤3], label: string }]`. **Titles are not persisted** (only handles); the storefront fetches product titles. Legacy `gift_threshold_paise` + `gift_products` are a half-deploy fallback synthesized into "tier 1" when `gift_tiers` is absent.

### 6.5 Inferred `loyalty_*` schema (from code)
- `loyalty_customers` — PK `shopify_customer_id`, `email?`, `first_name?`, `created_at`.
- `loyalty_ledger` — `id` PK, `customer_id`, `type` ∈ {`earn_order`,`earn_signup`,`earn_card`,`earn_tier`,`clawback`,`redeem`}, `points` (signed), `order_id`, `order_name`, `available_at`, `amount_paise` (signed), `note`, `ref_id`.
- `loyalty_balances` *(view)* — `customer_id`, `available`, `pending`, `lifetime_earned`.
- `loyalty_metrics` *(single-row view)* — `customers`, `points_order`, `points_signup`, `points_redeemed`, `points_pending`, `points_available`. (`getMetrics()` uses `.single()` → throws/500s if missing.)
- `loyalty_spend` *(view)* — `customer_id`, `total_paise`, `buffered_paise`.
- `loyalty_programs` — `id`, `type` ∈ {`store_credit`,`discount`,`free_gift`,`free_shipping`}, `name`, `active`, `discount_kind`, `discount_value`, `points_required`, `min_order_amount`, `product_id`, `product_title`.
- `loyalty_redemptions` — `customer_id`, `ledger_id`, `program_id`, `reward_type`, `points_spent`, `value_paise`, `shopify_ref`, `shopify_discount_id`, `title`, `created_at`.
- `loyalty_tiers` — `id`, `name`, `entry_amount`, `multiplier`, `entry_reward_type`, `entry_bonus_points`, `entry_discount_kind/value`, `entry_product_id/title`, `ongoing_type`, `ongoing_discount_kind/value`, `ongoing_product_id/title`. Sorted by `entry_amount` asc; highest qualifying tier wins.
- `loyalty_webhook_log` — `id`, `topic`, `webhook_id`, `ref`, `ok`, `message`.

### 6.6 Campaign cards (committed in `0001`)
- `campaign_cards` — `card_number` PK, `metaobject_id` NOT NULL, `amount`, `max_claims`, `claim_count` (default 0, **source of truth for the pool**), `expires_at?`, `status` (default `'active'`).
- `card_claims` — composite PK `(card_number, customer_id)` (per-customer-once guard), `credit_gid?`, `status` (default `'pending'`), `claimed_at`.
- RPC `claim_campaign_slot(p_card)` → bool: atomic `UPDATE … SET claim_count=claim_count+1 WHERE claim_count<max_claims AND status='active'` (row-locked; only one caller takes the final slot).
- RPC `release_campaign_slot(p_card)` → bool: decrements with underflow guard (rollback on credit failure).

> Footgun: `campaign_cards.amount/max_claims/expires_at` are frozen at first (lazy) seed via `INSERT … ON CONFLICT DO NOTHING`. Editing the Shopify metaobject afterward has **no effect** on the live pool. And `campaign_cards.status` stays `'active'` even when exhausted (exhaustion is enforced only by the RPC guard); the **metaobject** mirror is flipped to `'redeemed'` at max (to satisfy its `^(unused|redeemed|disabled)$` status regex). DB status and metaobject status intentionally diverge.

---

## 7. Auth flows

- **Embedded admin** (`/app/*`): every loader/action calls `await authenticate.admin(request)`. No finer-grained authorization than "authenticated admin." Shell = `app/routes/app.tsx` (`<AppProvider embedded>` + `<s-app-nav>`).
- **OAuth**: delegated to the library. `/auth/*` catch-all (`auth.$.tsx`); redirect allow-list `/auth/callback`, `/auth/shopify/callback`, `/api/auth/callback`.
- **App proxy** (`/apps/rewards/*` → `/proxy/*`): every proxy route calls `authenticate.public.appProxy(request)` which verifies only the **Shopify HMAC signature**, *not* the customer. Customer identity = the `logged_in_customer_id` query param Shopify injects (trusted because the whole proxied URL is signed). Mutating routes (`redeem`, `card/redeem`) hard-require it (401 if absent).
- **Webhooks**: `await authenticate.webhook(request)` (library verifies HMAC, auto-401). No manual signature handling.

App-proxy mapping (from `shopify.app.toml`): `prefix=apps`, `subpath=rewards`, `url=…/proxy` → storefront `https://dropy.in/apps/rewards/<x>` routes to Vercel `/proxy/<x>`.

---

## 8. Subsystems in detail

### 8.1 Admin UI routes
- **`app._index.tsx` (Dashboard, read-only)** — `Promise.all([getMetrics(), getConfig(), recentWebhooks()])`. Shows points totals, a liability figure (`(points_order+points_signup) * pointValuePaise/100`), and the last 8 `loyalty_webhook_log` rows. `getMetrics()` uses `.single()` on `loyalty_metrics` — **500s** if the view is empty/missing.
- **`app.program.tsx` (Loyalty Program)** — three client tabs (earning/redeeming/vip). Loader `Promise.all([getConfig(), listPrograms(), listTiers()])`. One `action` dispatches on a string `intent`: `save_place_order`/`save_signup`/`save_point_value` → `updateConfig`; `toggle_config` → `setConfigKey`; `create_program`/`toggle_program`/`delete_program` → `loyalty_programs`; `create_tier`/`delete_tier` → `loyalty_tiers`; `save_tier_buffer`/`save_tier_window`. Modals read **uncontrolled DOM inputs** via a `val(id)` helper and dismiss by `.click()`-ing a hidden button. Product pickers via App Bridge `resourcePicker`. **Action always returns `{ok:true, intent}`** even for unknown intents.
- **`app.gift.tsx` (Free Gift Popup)** — the multi-tier gift editor; talks to Supabase **directly** for `gift_tiers` (uses `setConfigKey` only for `gift_enabled`). Loader reads the 4 gift keys, converts paise→rupees (`round(/100)`), shows handle-as-title placeholder. `save` converts rupees→paise (`*100`), caps handles to 3, drops empty tiers, then `upsert`s the `gift_tiers` row. (It previously also synced a `$app:gift/tiers` metafield for the Function — that was removed in the revert.)
- **`app.customers.tsx` / `app.transactions.tsx` (read-only)** — newest 200 customers (joined to `loyalty_balances` in JS) / latest 100 ledger rows. **Search is purely client-side over the fetched rows** — no server pagination, so older records are unsearchable.

### 8.2 Server business logic
**`loyalty.server.ts`** — exports: `getConfig, logWebhook, earnFromOrder, clawbackFromRefund, signupPoints, getMetrics, updateConfig, listCustomers, listTransactions, recentWebhooks, setConfigKey, listPrograms, createProgram, setProgramActive, deleteProgram, redeemProgram, listCoupons, listTiers, createTier, deleteTier, setTierBuffer, getSpend, getCustomerTier, tierStatus, setTierWindow`. (`createShopifyReward`, `upsertCustomer`, `awardTierRewards`, `calcPoints`, `paise`, `genCode` are private.)
- Points math: `paise(s)=round(parseFloat(s)*100)`; `calcPoints(amountPaise,cfg)=floor(amountPaise*earnPoints/(earnAmount*100))`.
- `earnFromOrder(order, admin)` — earns on `order.subtotal_price` (post-discount, **pre-shipping**, so COD shipping fee is excluded), upserts customer, applies VIP multiplier + tier rewards if enabled, inserts `earn_order` with `available_at = now + pendingDays` (points **pend** first). Dup orders → `23505` → `duplicate-order`.
- `clawbackFromRefund(refund)` — sums refund txns (kind `refund`, status success/pending), inserts a `clawback` dedup row (`ref_id=refund-{id}`), reduces still-pending earn points first, records the remainder as negative.
- `signupPoints(customer)` — inserts `earn_signup` (deduped).
- `redeemProgram(admin, customerId, programId)` — **reservation-first but not fully atomic**: checks balance, inserts the negative `redeem` ledger row, creates the Shopify reward (`createShopifyReward`), **deletes the ledger row to roll back if reward creation throws**, then records `loyalty_redemptions`. A crash between deduct and reward leaves points stranded.
- `createShopifyReward()` branches on program type: `store_credit` → `storeCreditAccountCredit`; `free_shipping` → `discountCodeFreeShippingCreate`; `discount`/`free_gift` → `discountCodeBasicCreate` (gift = 100%-off a specific product). Codes `DRPY-XXXXXX` (`Math.random`, no collision check — relies on Shopify rejecting dups).
- VIP tiers: highest qualifying tier from `loyalty_spend.buffered_paise`; `awardTierRewards()` grants a one-per-customer entry bonus + optional ongoing reward, deduped by `ref_id=tier-{id}`. **Tier code-rewards only run on `orders/paid`** (the only place `admin` is available).

**`card.server.ts`** — exports `getCardByCode(admin, code)` and `claimCard(admin, customerId, code, db=sb)`. Cards are metaobjects type `dropy_credit_card`, handle `card-{16 digits}`.
- **Legacy single-use**: requires metaobject `status==="unused"`; single-claim guarded by `loyalty_ledger.ref_id=card-{code}` (`23505`→already redeemed); issues store credit (no expiry); flips metaobject `status:"redeemed"`.
- **Campaign (`card_type==="campaign"`)** — `claimCampaignCard()` ordering: validate amount/`max_claims`>0 → reject if past `expires_at` (**claim window**, before any writes) → lazily seed `campaign_cards` (DB is pool source of truth) → insert `card_claims` reservation (per-customer-once via PK) → `rpc claim_campaign_slot` (pool cap) → **only then** issue store credit with `expiresAt = now + credit_valid_days` (default **60**) → mark reservation `complete` + `credit_gid` → best-effort sync `claim_count`/`status` onto the metaobject. On credit failure: release slot **and** drop reservation so retry works. No order gate (acquisition cards target 0-order customers by design).
- `ClaimResult`: success `{ok:true, amount, currency, newBalance, transactionId}`; failure `{ok:false, error, status?, message?, http}`. Codes: `NOT_FOUND`/404, `NOT_REDEEMABLE`/409, `CREDIT_FAILED`/500, `EXPIRED`/409, `ALREADY_CLAIMED`/409, `FULLY_CLAIMED`/409, `INTERNAL_ERROR`/500.

**Tests** (`app/card.server.test.ts`, `npm test` → `vitest run`) — drive the real `claimCard()` against an in-memory `FakeDb` modeling PK uniqueness + the two RPCs as critical sections. Assert: pool cap (3 in, repeat/overflow rejected), 0-order customers allowed, double-submit credits once, two racers → one wins, `max_claims=0`/expired write no rows, `expiresAt`=now+`credit_valid_days` (default 60), credit-failure rolls back slot+reservation then retry succeeds, sync-back writes `claim_count`/`status=redeemed` while Supabase stays `active`, legacy regression (second claim blocked, no per-customer expiry, missing card → NOT_FOUND).

### 8.3 App proxy endpoints
| Route | Method | Auth+identity | Request | Response (success) |
|---|---|---|---|---|
| `/proxy/summary` | GET | sig only; `logged_in_customer_id` optional | — | `{loggedIn, coupons[], tier, balance{available,pending,lifetime_earned}, config{...}, programs[]}` |
| `/proxy/redeem` | POST | sig; `logged_in_customer_id` **required** (401) | form `program_id` | `{ok:true, type, name, code, detail}` |
| `/proxy/gift/config` | GET | sig only | — | `{enabled, tiers:[{threshold(paise),handles,label}], threshold, handles}` |
| `/proxy/card/validate` | POST | sig; no login | JSON `{code}` /^\d{16}$/ | `{valid:true, amount, currency:"INR"(hardcoded), batch_id}` |
| `/proxy/card/redeem` | POST | sig; `logged_in_customer_id` **required** (401) | JSON `{code}` /^\d{16}$/ | `{success:true, amount, currency, new_balance, transaction_id}` |

`gift/config.enabled` is true only when `gift_enabled==='1'` **and** at least one tier has handles. `thresholds are in PAISE` in the response (the admin works in rupees and `*100`s on write). Top-level `threshold`/`handles` are legacy superset fields for older widget assets.

### 8.4 Webhooks
All five are server-only `action`s, `await authenticate.webhook(request)` first. Declared in `shopify.app.toml` `[webhooks]` at `api_version 2026-07`.
- `app/uninstalled` → `db.session.deleteMany({where:{shop}})` (Prisma; guarded by `if(session)`). **Does not** delete Supabase loyalty data (GDPR note: no `customers/redact`/`shop/redact` webhooks are registered).
- `app/scopes_update` → `db.session.update` writes `payload.current.toString()` into `Session.scope`.
- `orders/paid` → `earnFromOrder(payload, admin)` (passes `admin` for tier rewards).
- `refunds/create` → `clawbackFromRefund(payload)`.
- `customers/create` → `signupPoints(payload)`.

The 3 loyalty webhooks share a wrapper: try/catch → always `logWebhook(...)` → **`throw 500` on failure to force Shopify retry**. Idempotency = Postgres `23505` mapped to benign `duplicate-*` success strings. Business no-ops (`no-customer`, `zero-points`, `*-disabled`) return 200 and are **not** retried (a late-attached customer simply doesn't earn — no replay).

### 8.5 Storefront widget (`extensions/rewards-widget/assets/rewards-widget.js`)
Two independent IIFEs, vanilla JS, XHR only.
- **Drawer** — floating pill + panel appended to `body`; lazy-loads `/apps/rewards/summary` on first open; renders points card, VIP tier progress, next-reward progress, "ways to earn", redeem buttons (POST `program_id` to `/apps/rewards/redeem`), and coupons. Login state comes from the **summary endpoint**, not the `data-logged-in` Liquid attr.
- **Gift popup + cart enforcement** — GETs `/apps/rewards/gift/config`; builds one hidden overlay per tier; fetches each gift via storefront `/products/{handle}.js` (uses `variants[0].id`). `pollCart()` GETs `/cart.js`, computes `totalWithoutGift` (subtracts **every** tier's gift line price), sets per-tier `giftInCart`, manages per-tier sessionStorage keys (`dropyGiftPopupSeen_`/`dropyGiftWasAdded_`/`dropyGiftRemoved_` + threshold), and runs a **single cooldown'd enforcement** (`t._lastFix`, 2s/tier): below threshold → `/cart/change.js {id: giftLine.key, quantity:0}` (+ set `keyRemoved`); at/above threshold with `qty>1` → `quantity:1` cap. Auto-pops at most one overlay (highest unseen+unremoved eligible tier). Exposes `window.dropyGiftSync = pollCart`.

> ⚠️ `pollCart()` has **no internal interval/cart-event listener** — it runs once ~300ms after tiers are ready and then only when something calls `window.dropyGiftSync`. Continuous enforcement depends on the theme calling it after cart changes. The "Claim" button injects only into `.cart-drawer__free-shipping`/`.main-cart__free-shipping` (theme-specific). This whole JS path is the **non-Plus workaround** for a native gift-with-purchase Function and is inherently racy/bypassable.

---

## 9. The free-gift saga (important context)

The multi-tier free gift went through three designs; the history is in the git log:
1. **Cumulative popup** (`ba2a120`) — JS popup adds gifts; problem: native Buy-X-Get-Y discounts don't stack (only one applies), so cumulative tiers couldn't be zeroed natively.
2. **Shopify Function** (`913261b`, `db63683`, `6169fd7`) — built a `product_discount` Function (`gift-discount-fn`) to zero all qualifying gift lines, config via `$app:gift/tiers` metafield. Got it building (the `core-js`/pnpm-workspace fix came out of this). **Then `discountAutomaticAppCreate` was rejected**: *custom-app Functions require Shopify Plus*; dropy.in is on the standard plan.
3. **Reverted** (`5bf5a13`) — deleted `extensions/gift-discount-fn/` and the `app.gift.tsx` metafield sync; **kept** all the multi-tier infra (Supabase `gift_tiers`, admin UI, `proxy.gift.config.tsx`, widget). Then enforcement hardening (`14047cd`, `c2e4a21`, `8110175`): single cooldown'd path, qty cap, stuck-gift retry.

**Net:** gifts are enforced **client-side** today (§8.5). A native discount Function is **not viable** here without a Plus upgrade or a public App Store listing. A stale deployed app version (`dropy-rewards-12`) may still contain the dead Function — harmless (nothing references it; it can't activate). See `memory/shopify-functions-need-plus.md`.

---

## 10. Consolidated risks / tech debt

- **Schema not reproducible from repo** — most `loyalty_*` DDL + the load-bearing UNIQUE indexes live only in prod Supabase. Export them; missing dedup indexes → double-issued points on webhook retries.
- **No migration runner** — SQL is applied by hand.
- **Service-role key everywhere** — any loader/action bug runs with full DB privileges on production data.
- **`redeemProgram` not atomic** — points-deduct → reward-create with manual rollback only on throw; a mid-flight crash strands points. No double-submit guard.
- **Campaign card pool freeze** — metaobject edits after first claim don't propagate; orphan `pending` `card_claims` rows block retries and need manual reconciliation.
- **API version skew** — Admin `2025-10` vs webhooks `2026-07`.
- **Scopes in three places**; `SHOPIFY_API_*` not in `.env` (must be in Vercel) and fail silently if absent.
- **Uncontrolled-DOM modals** in `app.program.tsx`; actions always report `{ok:true}`.
- **Plan gate** — store credit + any Function-backed reward may not activate on non-Plus dropy.in; the admin still lets you configure `free_gift`/`store_credit` rewards that won't function.
- **Widget**: enforcement depends on the theme calling `window.dropyGiftSync`; claim button is theme-class-specific; gift add triggers a full `window.location.reload()`.
- **Stale bits**: `_index/route.tsx` has placeholder marketing copy; `extensions/rewards-widget/locales/en.default.json` has unrelated "ratings" keys; README mentions SQLite (this fork is Postgres).
- **`.env` holds live service-role + DB password** in the working tree (gitignored, not in history) — rotate if leaked.

---

## 11. Current state (as of 2026-06-16)

- Branch `main`, remote `github.com/dropy-in/dropy-rewards`. HEAD = `8110175`.
- **`main` is 3 commits ahead of `origin/main`** (unpushed): `8110175`, `c2e4a21`, `14047cd` — **all `rewards-widget.js` enforcement changes.** These are extension-only and are **already live** via `shopify app deploy` (release **dropy-rewards-15**). Pushing them syncs GitHub/Vercel source but is **not** required for the live storefront widget (theme-extension assets are served by Shopify's CDN, not Vercel).
- The server-side gift revert (`5bf5a13`) and earlier are on `origin/main` (deployed by Vercel).
- Live extension release: **dropy-rewards-15**.

### Suggested next steps
1. `git push origin main` to sync the 3 widget commits (repo hygiene; harmless to Vercel).
2. Verify the prod Supabase has the UNIQUE indexes the dedup logic assumes (§6.3) — this is the highest-risk hidden dependency.
3. Export the live `loyalty_*` DDL into `supabase/migrations/` so the DB is reproducible.
4. Decide the gift strategy long-term: keep the JS enforcement, or pursue Plus / public App Store listing to use a real Function.
5. Replace placeholder landing copy and remove the stale widget locale file.

---

## 12. Runbook

```bash
# install (local uses pnpm)
pnpm install

# local dev (Shopify CLI injects SHOPIFY_API_* and tunnels)
shopify app dev                 # or: npm run dev

# typecheck / test
npm run typecheck               # react-router typegen && tsc --noEmit
npm test                        # vitest run

# deploy SERVER  (production)
git push origin main            # → Vercel (npm, package-lock.json)

# deploy EXTENSIONS (production)
shopify app deploy --config shopify.app.toml --allow-updates --allow-deletes

# apply DB schema changes
#   → paste supabase/migrations/*.sql into the Supabase SQL editor by hand
```

### Store / app identity
| | |
|---|---|
| Store | Dropy India — `dropy.in` / `7n0vkr-rn.myshopify.com` — plan **"Shopify"** (not Plus) |
| Prod app | `dropy-rewards` — client_id `00eed29be4a0e452a193f75c45788711` — `https://dropy-rewards.vercel.app` |
| Dev app | `dropy-rewards-dev` — client_id `b0ff0c6c254744081aea22e2ff792cf0` — `dropy-rewards-dev.myshopify.com` |
| Supabase | project `qehgeywmikgruwhvcbpq` (ap-south-1) |
| Scopes | `read_orders, read_customers, write_discounts, read_store_credit_accounts, write_store_credit_account_transactions, read_metaobjects, write_metaobjects` |

### Related memory notes
- `memory/supabase-no-migration-runner.md` — how data/schema/deploys actually work.
- `memory/shopify-functions-need-plus.md` — why the gift Function is plan-blocked.
