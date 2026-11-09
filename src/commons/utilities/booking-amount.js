const INTEGER_STRING = /^\d+$/;

/**
 * Parses the amount of a bookable item.
 * Accepts integers from 1, also as strings like "2".
 * @param {*} value The amount as received
 * @returns {number|null} The amount as number, or null if it is invalid
 */
function parseBookingAmount(value) {
  let amount;
  if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string" && INTEGER_STRING.test(value.trim())) {
    amount = Number(value.trim());
  } else {
    return null;
  }

  return Number.isSafeInteger(amount) && amount >= 1 ? amount : null;
}

/**
 * Validates the amount of every bookable item and converts it to a number in place.
 * @param {Array} bookableItems The bookable items of a booking attempt
 * @throws {Error} With cause code 400 if an amount is missing or invalid
 */
function validateBookableItemAmounts(bookableItems) {
  if (!Array.isArray(bookableItems)) return;

  for (const item of bookableItems) {
    const amount = parseBookingAmount(item?.amount);
    if (amount === null) {
      throw new Error(
        `Invalid amount for bookable ${item?.bookableId}: amount must be an integer of at least 1`,
        { cause: { code: 400 } },
      );
    }
    item.amount = amount;
  }
}

/**
 * Converts amounts stored as integer strings to numbers in place.
 * Leaves any other value untouched and never throws.
 * @param {Array} bookableItems The bookable items of a booking
 */
function coerceBookableItemAmounts(bookableItems) {
  if (!Array.isArray(bookableItems)) return;

  for (const item of bookableItems) {
    if (
      item &&
      typeof item.amount === "string" &&
      INTEGER_STRING.test(item.amount.trim())
    ) {
      const amount = Number(item.amount.trim());
      if (Number.isSafeInteger(amount)) {
        item.amount = amount;
      }
    }
  }
}

module.exports = {
  parseBookingAmount,
  validateBookableItemAmounts,
  coerceBookableItemAmounts,
};
