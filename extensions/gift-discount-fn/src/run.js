// Tiered, cumulative free-gift product discount.
//
// Replaces the two automatic Buy-X-Get-Y gifts (FREEGIFT2499 / FREEGIFT3999). Shopify only ever
// applies ONE Bxgy discount, which broke cumulative gifts. This single product_discount Function
// zeroes ALL qualifying gift lines itself, so any number of tiers stack.
//
// Config comes from the app-owned shop metafield $app:gift/tiers, synced from loyalty_config
// "gift_tiers" whenever the admin saves (see app/routes/app.gift.tsx). Shape:
//   { "tiers": [ { "threshold_paise": 249900, "handles": ["cerave-..."], "label": "..." }, ... ] }
//
// Gift lines are matched by PRODUCT HANDLE (the same handles the storefront popup adds), so no
// variant-id resolution and no read_products scope are needed; we target the actual cart line.

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

const EMPTY_DISCOUNT = { discountApplicationStrategy: "FIRST", discounts: [] };

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  const raw = input && input.shop && input.shop.metafield && input.shop.metafield.jsonValue;
  // Accept either { tiers: [...] } or a bare [...] for forward-compat.
  const tiers = raw && Array.isArray(raw.tiers) ? raw.tiers : Array.isArray(raw) ? raw : [];
  if (!tiers.length) return EMPTY_DISCOUNT;

  const lines = (input.cart && input.cart.lines) || [];
  if (!lines.length) return EMPTY_DISCOUNT;

  const handleOf = (line) => {
    const m = line.merchandise;
    return m && m.__typename === "ProductVariant" && m.product ? m.product.handle : null;
  };

  // Every gift handle across all tiers — excluded from the qualifying subtotal.
  const allGiftHandles = new Set();
  for (const t of tiers) for (const h of t.handles || []) allGiftHandles.add(h);

  // Subtotal EXCLUDING gift lines (mirrors the widget's totalWithoutGift), converted to paise.
  let subtotalExGifts = 0;
  for (const line of lines) {
    const h = handleOf(line);
    if (h && allGiftHandles.has(h)) continue; // a gift line — don't count it toward the threshold
    subtotalExGifts += parseFloat(line.cost.subtotalAmount.amount) || 0;
  }
  const subtotalPaise = Math.round(subtotalExGifts * 100);

  // Cumulative: collect the gift handles of EVERY tier whose threshold is met. A gift whose tier
  // isn't met stays full price.
  const unlockedHandles = new Set();
  for (const t of tiers) {
    const threshold = Number(t.threshold_paise) || 0;
    if (threshold > 0 && subtotalPaise >= threshold) {
      for (const h of t.handles || []) unlockedHandles.add(h);
    }
  }
  if (!unlockedHandles.size) return EMPTY_DISCOUNT;

  // Zero ONE unit of each cart line that is an unlocked gift. Never touch a non-gift line.
  const targets = [];
  for (const line of lines) {
    const h = handleOf(line);
    if (h && unlockedHandles.has(h)) {
      targets.push({ cartLine: { id: line.id, quantity: 1 } });
    }
  }
  if (!targets.length) return EMPTY_DISCOUNT;

  return {
    discountApplicationStrategy: "FIRST",
    discounts: [
      {
        message: "Free gift",
        value: { percentage: { value: "100.0" } },
        targets,
      },
    ],
  };
}
