# gift-discount — tiered cumulative free gifts (Shopify Function)

Replaces the two automatic Buy-X-Get-Y gifts (`FREEGIFT2499` / `FREEGIFT3999`). Shopify only
ever applies **one** Bxgy discount, so the two never stacked and cumulative gifts were broken.
This single `product_discount` Function zeroes **all** qualifying gift lines itself, so any number
of tiers stack with no limit.

## How it works

- **Config source of truth:** `loyalty_config.gift_tiers` in Supabase (managed by the gift admin
  page). On every save, `app/routes/app.gift.tsx` mirrors the tiers into the app-owned shop
  metafield **`$app:gift` / `tiers`** (type `json`):
  ```json
  { "tiers": [ { "threshold_paise": 249900, "handles": ["cerave-..."], "label": "CeraVe travel-size" },
               { "threshold_paise": 399900, "handles": ["the-ordinary-..."], "label": "The Ordinary Squalane Cleanser" } ] }
  ```
- **Matching:** the Function reads that metafield via `shop.metafield`, computes the cart subtotal
  **excluding gift lines** (mirroring the storefront popup's `totalWithoutGift`), and for every
  tier whose `threshold_paise` is met it zeroes **one unit** of each cart line whose **product
  handle** is one of that tier's gift handles. Gift lines are matched by handle (not pre-resolved
  variant ids), so no `read_products` scope is needed and it targets whatever variant the popup
  added.

## Deploy runbook

1. **Deploy the extension** (builds the Wasm + registers the function):
   ```
   shopify app deploy
   ```
   > If the function build fails (CLI build-toolchain mismatch on a hand-authored scaffold),
   > regenerate the scaffold and keep the logic:
   > ```
   > shopify app generate extension --template product_discount --flavor javascript --name gift-discount
   > ```
   > then restore this directory's `src/run.graphql` and `src/run.js` (both validated against the
   > 2026-07 `functions_product_discounts` schema).

2. **Populate the config metafield**: open the app's **Free Gift Popup** admin page and click
   **Save** once. The metafield is only written on save — until then the Function sees no tiers
   and zeroes nothing.

3. **Create the automatic discount** pointing at the Function (admin → Discounts, or run this in
   the app's GraphiQL / via the Admin API). `combinesWith` lets order discounts like `FIRST200`
   still stack while keeping this the only product-class gift discount:
   ```graphql
   mutation {
     discountAutomaticAppCreate(automaticAppDiscount: {
       title: "Free Gifts (tiered)",
       functionHandle: "gift-discount",
       startsAt: "2026-01-01T00:00:00Z",
       combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }
     }) {
       automaticAppDiscount { discountId }
       userErrors { field message }
     }
   }
   ```

4. **Retire the Bxgy** — only after the Function discount is live and tested: delete (or leave
   deactivated) `FREEGIFT2499` and `FREEGIFT3999`. Do **not** leave `FREEGIFT2499` active
   alongside the Function or a qualifying gift could be double-processed.

## Manual test plan

With the Function live, the discount created, and tiers saved (CeraVe @ ₹2,499, The Ordinary @ ₹3,999):

- Cart paid-subtotal **₹2,500** + CeraVe gift → CeraVe line **₹0**; Ordinary (if present) full price.
- Add to **₹4,000** + Ordinary gift → **both** gift lines ₹0; order subtotal reflects only paid items.
- `FIRST200` (order-class) still applies on top.
- Remove items below **₹3,999** → Ordinary no longer zeroed (the popup also auto-removes it).
- Below **₹2,499** → neither gift zeroed (popup removes them).
