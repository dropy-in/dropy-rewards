# gift-discount-fn — tiered cumulative free gifts (Shopify Function)

`product_discount` Function (handle: **`gift-discount-fn`**) that replaces the two automatic
Buy-X-Get-Y gifts (`FREEGIFT2499` / `FREEGIFT3999`). Shopify only ever applies **one** Bxgy
discount, so they never stacked and cumulative gifts were broken. This single Function zeroes
**all** qualifying gift lines itself, so any number of tiers stack with no limit.

Scaffolded with `shopify app generate extension --template product_discounts --flavor vanilla-js`
(so the Wasm build wiring — `@shopify/shopify_function` + javy via `shopify app function build` —
is correct); `src/run.graphql` and `src/run.js` hold the ported logic.

## How it works

- **Config source of truth:** `loyalty_config.gift_tiers` in Supabase (managed by the gift admin
  page). On every save, `app/routes/app.gift.tsx` mirrors the tiers into the app-owned shop
  metafield **`$app:gift` / `tiers`** (type `json`):
  ```json
  { "tiers": [ { "threshold_paise": 249900, "handles": ["cerave-..."], "label": "CeraVe travel-size" },
               { "threshold_paise": 399900, "handles": ["the-ordinary-..."], "label": "The Ordinary Squalane Cleanser" } ] }
  ```
- **Matching:** the Function reads that metafield via `shop.metafield`, computes the cart subtotal
  **excluding gift lines** (mirroring the popup's `totalWithoutGift`), and for every tier whose
  `threshold_paise` is met it zeroes **one unit** of each cart line whose **product handle** is one
  of that tier's gift handles. Matching by handle needs no `read_products` scope and targets
  whatever variant the popup added.

## Build

```
cd extensions/gift-discount-fn
npm run build          # shopify app function build → typegen + bundle + javy → dist/function.wasm
```
(`dist/` and `generated/` are gitignored and rebuilt on each build / `shopify app deploy`.)

## Deploy + setup runbook

1. **Deploy** the app (builds + registers the function): `shopify app deploy`
2. **Populate the config metafield**: open the app's **Free Gift Popup** admin page and click
   **Save** once — the metafield is only written on save; until then the Function sees no tiers.
3. **Create the automatic discount** pointing at this Function (`combinesWith` keeps order
   discounts like `FIRST200` stacking while this stays the only product-class gift discount):
   ```graphql
   mutation {
     discountAutomaticAppCreate(automaticAppDiscount: {
       title: "Free Gifts (tiered)",
       functionHandle: "gift-discount-fn",
       startsAt: "2026-01-01T00:00:00Z",
       combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }
     }) {
       automaticAppDiscount { discountId }
       userErrors { field message }
     }
   }
   ```
4. **Retire the Bxgy** — only after this is live and tested: delete (or leave deactivated)
   `FREEGIFT2499` and `FREEGIFT3999`. Don't leave `FREEGIFT2499` active alongside the Function or
   a gift could double-process.

## Manual test plan

Tiers: CeraVe @ ₹2,499, The Ordinary @ ₹3,999.

- Cart paid-subtotal **₹2,500** + CeraVe gift → CeraVe line **₹0**; Ordinary (if present) full price.
- Add to **₹4,000** + Ordinary gift → **both** gift lines ₹0; subtotal reflects only paid items.
- `FIRST200` (order-class) still applies on top.
- Remove items below **₹3,999** → Ordinary no longer zeroed (popup also auto-removes it).
- Below **₹2,499** → neither gift zeroed (popup removes them).
