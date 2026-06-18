// @ts-check

const GIFT_TIER2_MIN = 3999;

/**
 * @param {any} input
 * @returns {any}
 */
export function cartValidationsGenerateRun(input) {
  const errors = [];
  const cart = input.cart;

  let hasGiftTier2 = false;
  for (const line of cart.lines) {
    if (line.merchandise?.__typename !== "ProductVariant") continue;
    if (line.merchandise.product?.hasAnyTag) {
      hasGiftTier2 = true;
      break;
    }
  }

  if (!hasGiftTier2) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  let totalExcludingGifts = 0;
  for (const line of cart.lines) {
    if (line.merchandise?.__typename !== "ProductVariant") continue;
    if (line.merchandise.product?.hasAnyTag) continue;
    totalExcludingGifts += parseFloat(line.cost.totalAmount.amount);
  }

  if (totalExcludingGifts < GIFT_TIER2_MIN) {
    const remaining = Math.ceil(GIFT_TIER2_MIN - totalExcludingGifts);
    errors.push({
      message: `Add ₹${remaining.toLocaleString("en-IN")} more to qualify for the free gift. Remove the Squalane Cleanser or add more items.`,
      target: "cart",
    });
  }

  return {
    operations: [{ validationAdd: { errors } }],
  };
}
