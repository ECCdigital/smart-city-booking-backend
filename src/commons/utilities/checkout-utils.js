const { v4: uuidv4 } = require("uuid");
const UserManager = require("../data-managers/user-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const { DOMAIN } = require("../services/authorization/reach");

function primaryEmailFromMail(mail) {
  if (!mail) {
    return "";
  }

  const primary = mail
    .split(/[,\n]+/)
    .map((email) => email.trim())
    .filter(Boolean)[0];

  return primary ? primary.toLowerCase() : "";
}

async function resolveCheckoutId(checkoutId, userID, tenantId) {
  if (checkoutId) {
    return { checkoutId, generated: false };
  }

  if (userID) {
    const rawUser = await UserManager.getRawUser(userID, tenantId);
    if (rawUser) {
      const id =
        typeof rawUser._id === "string" ? rawUser._id : rawUser._id.toString();

      return { checkoutId: "01" + id, generated: false };
    }
  }
  return { checkoutId: "01" + uuidv4(), generated: true };
}

/**
 * Resolve the effective checkout items: copies of the given items with every
 * mandatory addon present at its parent's amount. The one addon rule for the
 * validate and checkout paths — pure, complete list, no caller mutation.
 * @param {Array<{bookableId: string, amount: number}>} bookableItems
 * @param {string} tenantId
 * @returns {Promise<Array<{bookableId: string, amount: number}>>}
 */
async function resolveCheckoutItems(bookableItems, tenantId) {
  const bookableIds = bookableItems.map((item) => item.bookableId);
  const bookables = await Promise.all(
    bookableIds.map((id) => BookableManager.getBookable(id, tenantId, DOMAIN)),
  );

  const bookableMap = new Map();
  for (let i = 0; i < bookableIds.length; i++) {
    bookableMap.set(bookableIds[i], bookables[i]);
  }

  const mandatoryAddons = [];
  for (const item of bookableItems) {
    const bookable = bookableMap.get(item.bookableId);
    if (bookable && Array.isArray(bookable.checkoutBookableIds)) {
      for (const addon of bookable.checkoutBookableIds) {
        if (addon.mandatory) {
          mandatoryAddons.push({
            bookableId: addon.bookableId,
            amount: item.amount,
          });
        }
      }
    }
  }

  const items = bookableItems.map((item) => ({ ...item }));
  for (const mandatoryAddon of mandatoryAddons) {
    const existingAddon = items.find(
      (item) => item.bookableId === mandatoryAddon.bookableId,
    );

    if (existingAddon) {
      if (existingAddon.amount !== mandatoryAddon.amount) {
        existingAddon.amount = mandatoryAddon.amount;
      }
    } else {
      items.push({
        bookableId: mandatoryAddon.bookableId,
        amount: mandatoryAddon.amount,
      });
    }
  }

  return items;
}

/**
 * Count the units of each bookable a booking holds against the bookable's
 * maximum per booking: the sum over the booking's positions of it. A
 * mandatory addon of a position counts nothing, its amount follows the
 * position's.
 * @param {Array<{bookableId: string, amount: number}>} bookableItems
 * @param {string} tenantId
 * @returns {Promise<Map<string, number>>} bookableId -> counted units
 */
async function countAmountsInBooking(bookableItems, tenantId) {
  const bookableIds = [
    ...new Set(bookableItems.map((item) => item.bookableId)),
  ];
  const bookables = await Promise.all(
    bookableIds.map((id) => BookableManager.getBookable(id, tenantId, DOMAIN)),
  );

  const mandatoryIds = new Set();
  for (const bookable of bookables) {
    if (bookable && Array.isArray(bookable.checkoutBookableIds)) {
      for (const addon of bookable.checkoutBookableIds) {
        if (addon.mandatory) mandatoryIds.add(addon.bookableId);
      }
    }
  }

  const counted = new Map();
  for (const item of bookableItems) {
    const units = mandatoryIds.has(item.bookableId) ? 0 : Number(item.amount);
    counted.set(item.bookableId, (counted.get(item.bookableId) || 0) + units);
  }
  return counted;
}

module.exports = {
  resolveCheckoutId,
  primaryEmailFromMail,
  resolveCheckoutItems,
  countAmountsInBooking,
};
